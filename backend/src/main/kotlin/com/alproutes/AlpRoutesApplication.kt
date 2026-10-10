package com.alproutes

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableAsync

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableAsync
class AlpRoutesApplication

fun main(args: Array<String>) {
    runApplication<AlpRoutesApplication>(*args)
}
