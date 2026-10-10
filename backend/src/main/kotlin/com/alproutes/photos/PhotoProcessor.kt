package com.alproutes.photos

import com.alproutes.media.MediaStorage
import com.drew.imaging.ImageMetadataReader
import com.drew.metadata.Metadata
import com.drew.metadata.exif.ExifIFD0Directory
import com.drew.metadata.exif.ExifSubIFDDirectory
import com.drew.metadata.exif.GpsDirectory
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Component
import org.springframework.transaction.event.TransactionPhase
import org.springframework.transaction.event.TransactionalEventListener
import java.awt.Color
import java.awt.RenderingHints
import java.awt.geom.AffineTransform
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Turns an uploaded original into public derivatives: EXIF orientation applied, all metadata
 * stripped (re-encoded pixels only), three sizes as JPEG. Capture time and GPS are read from the
 * original and stored as columns; the original itself never becomes public.
 *
 * Runs after the creating transaction commits, off the request thread.
 */
@Component
class PhotoProcessor(private val photos: PhotoRepository, private val storage: MediaStorage) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    fun onUploaded(event: PhotoUploaded) = process(event.photoId)

    fun process(photoId: UUID) {
        try {
            val key = photos.storageKey(photoId) ?: return
            val bytes = storage.read(key)
            val meta = runCatching { ImageMetadataReader.readMetadata(ByteArrayInputStream(bytes)) }.getOrNull()
            val decoded = ImageIO.read(ByteArrayInputStream(bytes))
                ?: throw IllegalArgumentException("Unsupported image format (HEIC is not supported yet)")
            val image = orient(decoded, meta?.orientation() ?: 1)

            for (size in PhotoSize.entries) {
                storage.putPublic(size.storageKey(photoId), jpeg(scaleDown(image, size.maxSide)), "image/jpeg")
            }
            val gps = meta?.location()
            photos.markReady(photoId, image.width, image.height, meta?.takenAt(), gps?.first, gps?.second)
        } catch (e: Exception) {
            log.warn("Photo {} processing failed: {}", photoId, e.toString())
            photos.markFailed(photoId)
        }
    }

    private fun Metadata.orientation(): Int? =
        getFirstDirectoryOfType(ExifIFD0Directory::class.java)?.getInteger(ExifIFD0Directory.TAG_ORIENTATION)

    /**
     * Capture time only when the camera recorded its UTC offset: EXIF dates are local time,
     * and guessing the zone would store a wrong instant.
     */
    private fun Metadata.takenAt(): OffsetDateTime? {
        val dir = getFirstDirectoryOfType(ExifSubIFDDirectory::class.java) ?: return null
        val local = dir.getString(ExifSubIFDDirectory.TAG_DATETIME_ORIGINAL) ?: return null
        val offset = dir.getString(ExifSubIFDDirectory.TAG_TIME_ZONE_ORIGINAL) ?: return null
        return runCatching {
            LocalDateTime.parse(local.trim(), DateTimeFormatter.ofPattern("yyyy:MM:dd HH:mm:ss"))
                .atOffset(ZoneOffset.of(offset.trim()))
                .withOffsetSameInstant(ZoneOffset.UTC)
        }.getOrNull()
    }

    private fun Metadata.location(): Pair<Double, Double>? {
        val geo = getFirstDirectoryOfType(GpsDirectory::class.java)?.geoLocation ?: return null
        if (geo.isZero || geo.latitude.isNaN() || geo.longitude.isNaN()) return null
        return geo.longitude to geo.latitude
    }

    /** EXIF orientation 1–8 → upright pixels. Topo coordinates are relative to this upright image. */
    private fun orient(src: BufferedImage, orientation: Int): BufferedImage {
        if (orientation !in 2..8) return src
        val w = src.width.toDouble()
        val h = src.height.toDouble()
        val swap = orientation >= 5
        val t = AffineTransform()
        when (orientation) {
            2 -> { t.translate(w, 0.0); t.scale(-1.0, 1.0) }
            3 -> { t.translate(w, h); t.rotate(Math.PI) }
            4 -> { t.translate(0.0, h); t.scale(1.0, -1.0) }
            5 -> { t.rotate(Math.PI / 2); t.scale(1.0, -1.0) }
            6 -> { t.translate(h, 0.0); t.rotate(Math.PI / 2) }
            7 -> { t.scale(-1.0, 1.0); t.translate(-h, 0.0); t.translate(0.0, w); t.rotate(3 * Math.PI / 2) }
            8 -> { t.translate(0.0, w); t.rotate(3 * Math.PI / 2) }
        }
        val out = BufferedImage(if (swap) src.height else src.width, if (swap) src.width else src.height, BufferedImage.TYPE_INT_RGB)
        val g = out.createGraphics()
        g.color = Color.WHITE
        g.fillRect(0, 0, out.width, out.height)
        g.drawImage(src, t, null)
        g.dispose()
        return out
    }

    /** Halves in steps, then a final bicubic pass: plain one-step downscaling aliases badly. */
    private fun scaleDown(src: BufferedImage, maxSide: Int): BufferedImage {
        var img = toRgb(src)
        val longest = max(img.width, img.height)
        if (longest <= maxSide) return img
        val scale = maxSide.toDouble() / longest
        val targetW = max(1, (img.width * scale).roundToInt())
        val targetH = max(1, (img.height * scale).roundToInt())
        while (img.width / 2 >= targetW && img.height / 2 >= targetH) {
            img = resize(img, img.width / 2, img.height / 2)
        }
        return resize(img, targetW, targetH)
    }

    private fun resize(src: BufferedImage, w: Int, h: Int): BufferedImage {
        val out = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        val g = out.createGraphics()
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC)
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY)
        g.drawImage(src, 0, 0, w, h, null)
        g.dispose()
        return out
    }

    /** Flattens transparency onto white: JPEG has no alpha. */
    private fun toRgb(src: BufferedImage): BufferedImage {
        if (src.type == BufferedImage.TYPE_INT_RGB) return src
        val out = BufferedImage(src.width, src.height, BufferedImage.TYPE_INT_RGB)
        val g = out.createGraphics()
        g.color = Color.WHITE
        g.fillRect(0, 0, src.width, src.height)
        g.drawImage(src, 0, 0, null)
        g.dispose()
        return out
    }

    private fun jpeg(img: BufferedImage): ByteArray {
        val writer = ImageIO.getImageWritersByFormatName("jpeg").next()
        val out = ByteArrayOutputStream()
        ImageIO.createImageOutputStream(out).use { stream ->
            writer.output = stream
            val param = writer.defaultWriteParam.apply {
                compressionMode = ImageWriteParam.MODE_EXPLICIT
                compressionQuality = 0.85f
            }
            writer.write(null, IIOImage(img, null, null), param)
        }
        writer.dispose()
        return out.toByteArray()
    }
}
