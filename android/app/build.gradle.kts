import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val versionProps = Properties()
val versionFile = rootProject.file("version.properties")
if (versionFile.exists()) {
    versionFile.inputStream().use { versionProps.load(it) }
}
val appVersionName = versionProps.getProperty("VERSION_NAME", "1.0.0")
val appVersionCode = versionProps.getProperty("VERSION_CODE", "10000").toInt()

val releaseStorePath = System.getenv("LLEGADA_KEYSTORE")
    ?: rootProject.file("llegada-release.jks").absolutePath
val releaseStoreFile = file(releaseStorePath)
val hasReleaseKey = releaseStoreFile.exists() &&
    !System.getenv("LLEGADA_KEYSTORE_PASSWORD").isNullOrBlank() &&
    !System.getenv("LLEGADA_KEY_ALIAS").isNullOrBlank()

android {
    namespace = "com.carpediego.llegada"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.carpediego.llegada"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
        resValue("string", "app_version_name", appVersionName)
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = System.getenv("LLEGADA_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("LLEGADA_KEY_ALIAS")
                keyPassword = System.getenv("LLEGADA_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
}
