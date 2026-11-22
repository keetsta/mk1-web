#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "face.h"
#include "hal.h"
#include "shell.h"

#define IMPORT(name) __attribute__((import_module("mk1"), import_name(name)))
#define EXPORT(name) __attribute__((export_name(name)))

IMPORT("write") void js_write(const char *s, size_t n);
IMPORT("screen") void js_screen(const uint8_t *levels);
IMPORT("button") int js_button(void);
IMPORT("lux") uint32_t js_lux(void);
IMPORT("load") int js_load(void *buf, size_t n);
IMPORT("save") void js_save(const void *buf, size_t n);
IMPORT("exit") void js_exit(void);

static uint32_t ms;
static uint8_t linked, typed;
static uint8_t shown[9][16];

void hal_write(const char *s, size_t n) { js_write(s, n); }
void hal_matrix(const uint16_t rows[9]) { face_shell(rows); }
int hal_button(void) { return js_button(); }
uint16_t hal_lux(void) { return (uint16_t)js_lux(); }
int hal_rows(void) { return 0; } /* xterm.js keeps its own scrollback: no paging */
void hal_exit(void) { face_exit(); js_exit(); }
int hal_load(void *buf, size_t n) { return js_load(buf, n); }
void hal_save(const void *buf, size_t n) { js_save(buf, n); }

EXPORT("init") void mk1_init(void) {
    face_init(0);
    shell_init();
}

EXPORT("connect") void mk1_connect(void) {
    linked = 1;
    shell_connect();
}

EXPORT("disconnect") void mk1_disconnect(void) {
    linked = 0;
    shell_disconnect();
}

EXPORT("input") void mk1_input(int c) {
    typed = 1;
    shell_input((char)c);
}

EXPORT("tick") void mk1_tick(uint32_t rnd) {
    uint8_t lum[9][16];
    ms += 20;
    shell_tick();
    face_in in = {ms, (uint8_t)hal_button(), linked, (uint8_t)shell_running(), typed, rnd};
    typed = 0;
    face_tick(&in);
    face_render(lum);
    if (memcmp(shown, lum, sizeof shown)) {
        memcpy(shown, lum, sizeof shown);
        js_screen(lum[0]);
    }
}

EXPORT("running") int mk1_running(void) { return shell_running(); }
