/* The card's HAL in the browser: the shell core compiled to WebAssembly for "try it".
 * Every hal_* call goes out to a JS import (module "mk1"); JS drives the shell through the exports.
 * The core is the same source as the firmware's (the shell/ submodule), only this file is new.
 */
#include <stddef.h>
#include <stdint.h>

#include "hal.h"
#include "shell.h"

#define IMPORT(name) __attribute__((import_module("mk1"), import_name(name)))
#define EXPORT(name) __attribute__((export_name(name)))

IMPORT("write") void js_write(const char *s, size_t n);
IMPORT("matrix") void js_matrix(const uint16_t *rows);
IMPORT("button") int js_button(void);
IMPORT("lux") uint32_t js_lux(void);
IMPORT("load") int js_load(void *buf, size_t n);
IMPORT("save") void js_save(const void *buf, size_t n);
IMPORT("exit") void js_exit(void);

void hal_write(const char *s, size_t n) { js_write(s, n); }
void hal_matrix(const uint16_t rows[9]) { js_matrix(rows); }
int hal_button(void) { return js_button(); }
uint16_t hal_lux(void) { return (uint16_t)js_lux(); }
int hal_rows(void) { return 0; } /* xterm.js keeps its own scrollback: no paging */
void hal_exit(void) { js_exit(); }
int hal_load(void *buf, size_t n) { return js_load(buf, n); }
void hal_save(const void *buf, size_t n) { js_save(buf, n); }

EXPORT("init") void mk1_init(void) { shell_init(); }
EXPORT("input") void mk1_input(int c) { shell_input((char)c); }
EXPORT("tick") void mk1_tick(void) { shell_tick(); }
EXPORT("running") int mk1_running(void) { return shell_running(); }
