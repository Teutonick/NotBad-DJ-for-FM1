/* SPDX-License-Identifier: MPL-2.0 */
#pragma once
#include "plat.h"

#define APP_NAME "FM-1 DJ"
#define APP_SPLASH_RGB RGB(79, 212, 228)
#define APP_CANVAS_PX (240u * 80u)
#define APP_BLOCK 256u
#define APP_SYSEX

enum { OBJ_PANEL, OBJ_NOBJ };
#define APP_STORE_MAP {0xDC000u}

void app_init(void);
void app_render(int32_t *lr, uint32_t n, uint32_t master);
void app_panic(void);
void app_ui_init(void);
void app_frame(void);
void app_input_only(void);
void app_say(const char *a, const char *b);
