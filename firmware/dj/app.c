/* SPDX-License-Identifier: MPL-2.0 */
#include "app.h"

enum { DECK_BYTES = 55, PAYLOAD_BYTES = 3 + 2 * DECK_BYTES };
static uint8_t state[PAYLOAD_BYTES], sequence;
static uint32_t packet_ms, last_frame, last_keys, last_buttons, last_link;
static int online, fresh;
static int parameter = -1;
static uint32_t parameter_ms;

#define BG RGB(15, 20, 28)
#define PANEL RGB(28, 37, 49)
#define TEXT RGB(229, 236, 244)
#define DIM RGB(155, 174, 193)
#define CYAN RGB(79, 212, 228)
#define ORANGE RGB(255, 164, 92)

static void send_midi(uint8_t status, unsigned number, unsigned value)
{
    plat_midi_out((status >> 4) | ((uint32_t)status << 8) | (number << 16) | (value << 24));
}

static int current_session(void)
{
    return plat_usb_session() && fresh && plat_ms() - packet_ms < 1500u;
}

int app_sysex(const uint8_t *p, uint32_t n)
{
    if (n < 7 || p[0] != 0x7d || p[1] != 0x46 || p[2] != 0x44) return 0;
    if (p[3] != 1) return 1;
    unsigned checksum = 0;
    for (unsigned i = 0; i < n; ++i) checksum += p[i];
    if (checksum & 127u) return 1;
    if (p[4] == 0 && n == 7) {
        static const uint8_t version[] = {0xf0, 0x7d, 0x46, 0x44, 1, 2, 0, 0, 1, 1, 0x74, 0xf7};
        fresh = 0;
        plat_sysex_send(version, sizeof version);
        return 1;
    }
    if (p[4] == 1 && n == PAYLOAD_BYTES + 7) {
        unsigned distance = (p[5] - sequence) & 127u;
        if (current_session() && (distance == 0 || distance > 64)) return 1;
        sequence = p[5];
        memcpy(state, p + 6, PAYLOAD_BYTES);
        packet_ms = plat_ms();
        fresh = 1;
    }
    return 1;
}

void app_init(void) {}
void app_panic(void) { plat_usb_play_gain(0); }
void app_say(const char *a, const char *b) { (void)a; (void)b; }

void app_render(int32_t *lr, uint32_t n, uint32_t master)
{
    (void)master;
    for (uint32_t i = 0; i < 2 * n; ++i) lr[i] = 0;
}

void app_input_only(void)
{
    const uint32_t keys = plat_keys(), buttons = plat_buttons();
    const uint32_t changed = keys ^ last_keys;
    const uint32_t previous_buttons = last_buttons;
    const uint32_t pressed = buttons & ~previous_buttons;
    const uint32_t link = plat_usb_session();
    if (link != last_link) {
        last_link = link;
        fresh = 0;
    }
    last_keys = keys;
    last_buttons = buttons;
    online = current_session();
    plat_usb_play_gain(online ? 3072 : 0);
    if (online) {
        static const uint8_t panel_notes[NB] = {
            [B_OCTDN] = 85, [B_OCTUP] = 86, [B_SEL] = 87,
            [B_PLAY] = 88, [B_HOME] = 89, [B_FX] = 90, [B_EDIT] = 91,
            [B_GLO] = 92, [B_ENV] = 93, [B_ARP] = 94, [B_LFO] = 95,
            [B_SEQ] = 96, [B_SAVE] = 97, [B_REC] = 98
        };
        /* Process deck selection and EDIT before commands using them. */
        if (pressed & (1u << B_OCTDN)) send_midi(0x90, panel_notes[B_OCTDN], 100);
        if (pressed & (1u << B_OCTUP)) send_midi(0x90, panel_notes[B_OCTUP], 100);
        if ((buttons ^ previous_buttons) & (1u << B_EDIT)) {
            unsigned down = (buttons >> B_EDIT) & 1u;
            send_midi(down ? 0x90 : 0x80, panel_notes[B_EDIT], down ? 100 : 0);
        }
        for (unsigned b = 0; b < NB; ++b) {
            if (b == B_OCTDN || b == B_OCTUP || b == B_EDIT) continue;
            if (panel_notes[b] && (pressed & (1u << b)))
                send_midi(0x90, panel_notes[b], 100);
        }
        /* The five leftmost piano keys are Nudge ± and Hot Cue 1–3. */
        for (unsigned k = 0; k < 5; ++k) {
            if ((changed >> k) & 1u) {
                unsigned down = (keys >> k) & 1u;
                send_midi(down ? 0x90 : 0x80, 99 + k, down ? 100 : 0);
            }
        }
    }
    for (int i = 0; i < NE; ++i) {
        int32_t delta = plat_enc(i);
        if (!online || !delta) continue;
        send_midi(0xb0, 16u + (unsigned)i, (unsigned)clamp(delta, -63, 63) & 127u);
        parameter = i;
        parameter_ms = plat_ms();
    }
}

static void format_number(unsigned v, char *out)
{
    unsigned place = 1000;
    while (place > 1 && v < place) place /= 10;
    for (; place; place /= 10) *out++ = (char)('0' + (v / place) % 10);
    *out = 0;
}

static void draw_deck(unsigned side)
{
    const uint8_t *d = state + 3 + side * DECK_BYTES;
    const uint16_t color = side ? ORANGE : CYAN;
    char title[21], bpm[8];
    memcpy(title, d + 11, 20);
    title[20] = 0;
    const unsigned tempo = d[1] + 128u * d[2];
    format_number((tempo + 5) / 10, bpm);
    cv_begin(240, 76, BG);
    cv_rect(6, 3, 228, 70, PANEL);
    cv_rect(6, 3, state[1] == side ? 4 : 2, 70, color);
    cv_text(14, 8, &FONT_L, side ? "B" : "A", color);
    cv_text(41, 8, &FONT_XS, online && title[0] > ' ' ? title : "NO TRACK", TEXT);
    cv_text(180, 8, &FONT_B, bpm, color);
    cv_text(213, 11, &FONT_XS, "BPM", DIM);
    cv_text(41, 25, &FONT_XS, d[0] & 1 ? "PLAY" : "PAUSE", TEXT);
    if (d[0] & 2) cv_text(89, 25, &FONT_XS, "SYNC", color);
    if (d[0] & 4) cv_text(126, 25, &FONT_XS, "CUE", color);
    cv_rect(178, 30, 50, 2, BG);
    cv_rect(178, 30, d[4] * 50 / 127, 2, color);
    for (unsigned i = 0; i < 24; ++i) {
        int height = 1 + d[31 + i] * 24 / 127;
        cv_rect(15 + i * 9, 55 - height / 2, 6, height, color);
    }
    cv_rect(15 + d[3] * 212 / 127, 40, 2, 29, TEXT);
    cv_blit(0, 34 + side * 76);
}

static void draw(void)
{
    cv_begin(240, 34, BG);
    cv_text(10, 7, &FONT_L, "FM-1 DJ", TEXT);
    cv_text(137, 12, &FONT_XS, online ? "USB CONNECTED" : "DISCONNECTED", online ? CYAN : DIM);
    cv_blit(0, 0);
    draw_deck(0);
    draw_deck(1);
    cv_begin(240, 54, BG);
    const uint8_t *d = state + 3 + (state[1] & 1u) * DECK_BYTES;
    if (online && parameter >= 0 && plat_ms() - parameter_ms < 900u) {
        static const char *const normal[] = {"LIBRARY", "CROSSFADER", "LIBRARY", "VOLUME", "LOW", "MID", "HIGH"};
        static const char *const shift[] = {"LIBRARY", "CROSSFADER", "LIBRARY", "FILTER", "TEMPO", "CUE MIX", "FX"};
        static const int offsets[] = {-1, -1, -1, 5, 6, 7, 8};
        const char *label = state[2] ? shift[parameter] : normal[parameter];
        int value = parameter == EN_ALGO ? state[0] : offsets[parameter] < 0 ? -1 : d[offsets[parameter]];
        if (state[2] && parameter >= EN_K1) {
            value = parameter == EN_K1 ? d[9] : parameter == EN_K4 ? d[10] : -1;
            if (parameter == EN_K2) value = (d[1] + 128 * d[2] + 5) / 10;
        }
        cv_text(10, 3, &FONT_B, label, TEXT);
        if (value >= 0) {
            char number[8];
            format_number(state[2] && parameter == EN_K2 ? value : value * 100 / 127, number);
            cv_text(195, 3, &FONT_B, number, TEXT);
        }
    } else {
        cv_text(10, 3, &FONT_XS, "A", CYAN);
        cv_text(222, 3, &FONT_XS, "B", ORANGE);
        cv_text(82, 3, &FONT_XS, "CROSSFADER", TEXT);
    }
    cv_rect(12, 31, 216, 4, PANEL);
    cv_rect(10 + state[0] * 212 / 127, 25, 8, 16, TEXT);
    cv_blit(0, 186);
}

void app_ui_init(void) { last_frame = plat_ms() - 125u; }

void app_frame(void)
{
    app_input_only();
    const uint32_t now = plat_ms();
    if (now - last_frame < 125u) return;
    last_frame = now;
    if (!online) memset(state, 0, sizeof state);
    uint32_t button_leds = last_buttons;
    if (online) {
        const unsigned active = state[1] & 1u;
        const uint8_t flags = state[3 + active * DECK_BYTES];
        button_leds |= 1u << (active ? B_OCTUP : B_OCTDN);
        if (flags & 1u) button_leds |= 1u << B_PLAY;
        if (flags & 2u) button_leds |= 1u << B_GLO;
        if (flags & 4u) button_leds |= 1u << B_ENV;
        if (flags & 8u) button_leds |= 1u << B_FX;
    }
    plat_leds(button_leds, online ? last_keys & 0x1fu : 0u);
    draw();
}
