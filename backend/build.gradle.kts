import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("org.springframework.boot") version "3.5.6"
    id("io.spring.dependency-management") version "1.1.7"
    kotlin("jvm") version "2.1.21"
    kotlin("plugin.spring") version "2.1.21"
}

group = "com.alproutes"
version = "0.1.0"

// Spring Boot's BOM pins Kotlin to its own baseline; keep stdlib in sync with the plugin.
extra["kotlin.version"] = "2.1.21"

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(21)) }
}

repositories {
    mavenCentral()
}

dependencyManagement {
    imports {
        // S3 pre-signed URLs. SigV4 presigning by hand is error-prone; the SDK is the reference.
        mavenBom("software.amazon.awssdk:bom:2.31.0")
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-security")
    // JWT: validates our access tokens and Google/Apple ID tokens (Nimbus is bundled).
    implementation("org.springframework.boot:spring-boot-starter-oauth2-resource-server")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("software.amazon.awssdk:s3")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("org.testcontainers:junit-jupiter")
    testImplementation("org.testcontainers:postgresql")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.addAll("-Xjsr305=strict")
    }
}

// Single source of truth for migrations: /infra/db/migration, packaged into the jar.
tasks.processResources {
    from("../infra/db/migration") {
        into("db/migration")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}
