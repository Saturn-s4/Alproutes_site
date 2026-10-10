import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.Polygon;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import javax.imageio.ImageIO;

/**
 * Generates SYNTHETIC sample media for local development: drawn "mountain" pictures and PDFs,
 * every one clearly labelled as test material. No real photos, no real route data.
 *
 *   java infra/dev-seed/GenerateSamples.java infra/dev-seed/samples
 */
public class GenerateSamples {

    record Palette(Color skyTop, Color skyBottom, Color far, Color near, Color snow) {}

    public static void main(String[] args) throws IOException {
        Path out = Path.of(args.length > 0 ? args[0] : "infra/dev-seed/samples");
        Files.createDirectories(out);

        Palette dawn = new Palette(new Color(250, 196, 150), new Color(255, 236, 214), new Color(150, 120, 140), new Color(80, 70, 90), new Color(255, 245, 240));
        Palette day = new Palette(new Color(70, 130, 200), new Color(190, 220, 245), new Color(110, 125, 145), new Color(60, 70, 80), Color.WHITE);
        Palette dusk = new Palette(new Color(40, 50, 90), new Color(240, 150, 100), new Color(90, 80, 110), new Color(40, 40, 60), new Color(230, 220, 235));
        Palette grey = new Palette(new Color(150, 160, 170), new Color(215, 220, 225), new Color(120, 125, 130), new Color(70, 75, 80), new Color(245, 245, 245));

        photo(out.resolve("description-1.jpg"), 2400, 1600, day, 1, "ФОТО ОПИСАНИЯ · 1", "общий вид");
        photo(out.resolve("description-2.jpg"), 2400, 1600, dawn, 2, "ФОТО ОПИСАНИЯ · 2", "фото для нитки");
        photo(out.resolve("description-3.jpg"), 1600, 2400, grey, 3, "ФОТО ОПИСАНИЯ · 3", "деталь участка");
        photo(out.resolve("user-1.jpg"), 2000, 1500, dusk, 4, "ФОТО УЧАСТНИКА · 1", "вечер на подходе");
        photo(out.resolve("user-2.jpg"), 2000, 1500, day, 5, "ФОТО УЧАСТНИКА · 2", "гребень");
        photo(out.resolve("user-3.jpg"), 1500, 2000, dawn, 6, "ФОТО УЧАСТНИКА · 3", "рассвет");
        photo(out.resolve("user-4.jpg"), 2000, 1500, grey, 7, "ФОТО УЧАСТНИКА · 4", "непогода");

        pdf(out.resolve("document-1.pdf"), "ТЕСТОВЫЙ ДОКУМЕНТ 1", 3);
        pdf(out.resolve("document-2.pdf"), "ТЕСТОВЫЙ ДОКУМЕНТ 2", 1);
        System.out.println("Samples written to " + out.toAbsolutePath());
    }

    // ------------------------------------------------------------------ photos

    static void photo(Path file, int w, int h, Palette p, long seed, String title, String subtitle) throws IOException {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        Random rnd = new Random(seed);

        g.setPaint(new GradientPaint(0, 0, p.skyTop(), 0, h * 0.7f, p.skyBottom()));
        g.fillRect(0, 0, w, h);
        ridge(g, rnd, w, h, h * 0.45, h * 0.25, p.far(), null);
        ridge(g, rnd, w, h, h * 0.62, h * 0.3, p.near(), p.snow());

        // A dashed "route" so the picture reads like a mountain photo with a line on it.
        g.setColor(new Color(240, 140, 80));
        g.setStroke(new BasicStroke(Math.max(4, w / 300f), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 10, new float[] {w / 60f, w / 90f}, 0));
        int x = (int) (w * 0.3), y = (int) (h * 0.9);
        for (int i = 0; i < 6; i++) {
            int nx = x + (int) (w * (0.03 + rnd.nextDouble() * 0.06)), ny = y - (int) (h * (0.06 + rnd.nextDouble() * 0.06));
            g.drawLine(x, y, nx, ny);
            x = nx; y = ny;
        }

        label(g, w, h, title, subtitle);
        g.dispose();
        ImageIO.write(img, "jpeg", file.toFile());
    }

    static void ridge(Graphics2D g, Random rnd, int w, int h, double base, double amp, Color fill, Color snow) {
        int n = 14;
        int[] xs = new int[n + 3];
        int[] ys = new int[n + 3];
        for (int i = 0; i <= n; i++) {
            xs[i] = (int) (w * i / (double) n);
            ys[i] = (int) (base - rnd.nextDouble() * amp * (i % 2 == 0 ? 0.5 : 1.0));
        }
        xs[n + 1] = w; ys[n + 1] = h;
        xs[n + 2] = 0; ys[n + 2] = h;
        g.setColor(fill);
        g.fillPolygon(xs, ys, n + 3);
        if (snow == null) return;
        g.setColor(snow);
        for (int i = 1; i < n; i += 2) {
            int px = xs[i], py = ys[i];
            int dl = (int) ((xs[i] - xs[i - 1]) * 0.35), dr = (int) ((xs[i + 1] - xs[i]) * 0.35);
            double sl = (ys[i - 1] - py) / (double) (xs[i] - xs[i - 1]);
            double sr = (ys[i + 1] - py) / (double) (xs[i + 1] - xs[i]);
            g.fillPolygon(new Polygon(new int[] {px, px - dl, px + dr}, new int[] {py, py + (int) (sl * dl), py + (int) (sr * dr)}, 3));
        }
    }

    /** Big, unmistakable test label: nobody should take these for real photos. */
    static void label(Graphics2D g, int w, int h, String title, String subtitle) {
        int size = Math.min(w, h) / 12;
        g.setColor(new Color(0, 0, 0, 150));
        g.fillRoundRect(w / 20, h / 20, (int) (w * 0.9), size * 3, size / 2, size / 2);
        g.setColor(Color.WHITE);
        g.setFont(new Font("Arial", Font.BOLD, size));
        g.drawString("ТЕСТ · " + title, w / 20 + size / 2, h / 20 + (int) (size * 1.3));
        g.setFont(new Font("Arial", Font.PLAIN, (int) (size * 0.6)));
        g.drawString(subtitle + " · сгенерировано, не настоящее фото", w / 20 + size / 2, h / 20 + (int) (size * 2.4));
    }

    // -------------------------------------------------------------------- PDFs

    /** PDF whose pages are rendered images: Cyrillic text without embedding fonts. */
    static void pdf(Path file, String title, int pages) throws IOException {
        List<byte[]> jpegs = new ArrayList<>();
        int pw = 1240, ph = 1754;   // A4 at 150 dpi
        for (int i = 1; i <= pages; i++) {
            BufferedImage img = new BufferedImage(pw, ph, BufferedImage.TYPE_INT_RGB);
            Graphics2D g = img.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setColor(Color.WHITE);
            g.fillRect(0, 0, pw, ph);
            g.setColor(new Color(20, 20, 20));
            g.setFont(new Font("Arial", Font.BOLD, 56));
            g.drawString(title, 100, 180);
            g.setFont(new Font("Arial", Font.PLAIN, 32));
            String[] lines = {
                "Страница " + i + " из " + pages,
                "",
                "Это сгенерированный файл для проверки интерфейса.",
                "Он не является описанием реального маршрута",
                "и не содержит фактических данных: категорий,",
                "перепадов, координат или имён первопроходцев.",
                "",
                "Правовой статус: собственная работа (own_work).",
            };
            for (int l = 0; l < lines.length; l++) g.drawString(lines[l], 100, 300 + l * 52);
            g.setColor(new Color(240, 140, 80));
            g.setStroke(new BasicStroke(6));
            g.drawRect(60, 60, pw - 120, ph - 120);
            g.dispose();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            ImageIO.write(img, "jpeg", buf);
            jpegs.add(buf.toByteArray());
        }

        // Objects: 1 catalog, 2 pages, then per page: page, content stream, image.
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        List<Integer> offsets = new ArrayList<>();
        write(out, "%PDF-1.4\n%âãÏÓ\n");
        StringBuilder kids = new StringBuilder();
        for (int i = 0; i < pages; i++) kids.append(3 + i * 3).append(" 0 R ");
        obj(out, offsets, "<< /Type /Catalog /Pages 2 0 R >>");
        obj(out, offsets, "<< /Type /Pages /Kids [" + kids + "] /Count " + pages + " >>");
        for (int i = 0; i < pages; i++) {
            int page = 3 + i * 3, content = page + 1, image = page + 2;
            obj(out, offsets, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im" + i + " " + image
                + " 0 R >> >> /Contents " + content + " 0 R >>");
            String draw = "q 595 0 0 842 0 0 cm /Im" + i + " Do Q";
            obj(out, offsets, "<< /Length " + draw.length() + " >>\nstream\n" + draw + "\nendstream");
            byte[] jpg = jpegs.get(i);
            offsets.add(out.size());
            write(out, image + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + pw + " /Height " + ph
                + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpg.length + " >>\nstream\n");
            out.write(jpg);
            write(out, "\nendstream\nendobj\n");
        }
        int xref = out.size();
        write(out, "xref\n0 " + (offsets.size() + 1) + "\n0000000000 65535 f \n");
        for (int off : offsets) write(out, String.format("%010d 00000 n \n", off));
        write(out, "trailer\n<< /Size " + (offsets.size() + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
        Files.write(file, out.toByteArray());
    }

    static void obj(ByteArrayOutputStream out, List<Integer> offsets, String body) throws IOException {
        offsets.add(out.size());
        write(out, offsets.size() + " 0 obj\n" + body + "\nendobj\n");
    }

    static void write(ByteArrayOutputStream out, String s) throws IOException {
        out.write(s.getBytes(StandardCharsets.ISO_8859_1));
    }
}
