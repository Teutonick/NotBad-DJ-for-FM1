# FM-1 DJ

Две браузерные деки и прошивка USB-контроллера для M-VAVE FM-1. Браузер декодирует и микширует локальные файлы. FM-1 принимает звук Cue по USB Audio и обменивается командами и состоянием по USB MIDI.

## Запуск

На опубликованной странице достаточно Chrome на macOS. Для локальной сборки выполните `npm ci --ignore-scripts`, затем `npm run build` и `npm run preview`. В GitHub Pages установите источник **GitHub Actions**. Workflow **Web checks and GitHub Pages** публикует `dist` из ветки `main`.

В библиотеке добавьте WAV, MP3 или FLAC, затем загрузите треки на A и B. Кнопка **Add demo tracks** импортирует два встроенных тестовых файла. [Beacon, 124 BPM](public/demo/Beacon-124.wav) и [Afterglow, 128 BPM](public/demo/Afterglow-128.wav) — сгенерированные метрономные фрагменты, CC0-1.0. Для проверки фазового Sync включите A, нажмите Sync на B и запустите B. В инструментах деки можно исправить BPM и положение сетки.

## Master и Cue

1. Установите динамики MacBook или внешний выход как системный Master в macOS. Подключите FM-1 по USB и вставьте проводные наушники в FM-1. Начните с малой громкости MASTER на корпусе.
2. Нажмите **Connect FM-1**, разрешите MIDI с SysEx. В настройках приложения на вкладке Audio выберите Master и отдельный Cue **FM-1 DJ**. Если Chrome скрывает имена, кнопка получения разрешения запрашивает доступ к аудиовходу и сразу освобождает его.
3. Нажмите **Enable Cue Output**. В Hardware diagnostics отдельно проверьте **Test Master** и **Test headphones**.
4. Установите Crossfader в A. Запустите обе деки и включите PFL B. В Master должен остаться A, а в наушниках должен появиться B. Повторите зеркально, затем включите оба PFL и проверьте Cue/Master.
5. Если FM-1 отключился, приложение заглушает Cue. После подключения проверьте название выхода и снова включите Cue.

## Firmware

Исходники в [firmware/dj](firmware/dj). `firmware/build.sh --host` собирает симулятор. Для файла устройства используйте Linux x86-64 или macOS с запущенным Docker/Podman, Python 3.12 и Pillow с Raqm. Выполните `firmware/base/tools/setup_toolchain.sh --only jieli,ac79-sdk` после первой host-сборки, затем `firmware/build.sh --release 0.1.0`. Установочный пакет создаётся в `firmware/dj/build`. Те же шаги выполняет workflow **FM-1 DJ firmware**.

Перед первой записью подготовьте штатный образ для вашей ревизии и проверьте процедуру возврата. Используйте официальный для этой базы [инсталлятор и раздел восстановления](https://charlesvestal.github.io/fm1-base/install/) либо [инструменты felucca-bsp](https://github.com/hugelton/felucca-bsp/tree/7b77bfbce8e0d185461a79d164c893551492ded1/tools). Командная установка требует `mido` и `python-rtmidi`. Из каталога проекта установку своего пакета выполняет `python3 firmware/base/tools/fm1_install.py firmware/dj/build/fm1-dj-0.1.0.fwsc`. Загрузчик для обычного обновления менять не требуется. После установки проверьте **FM-1 DJ** в Audio MIDI Setup и штатное восстановление на физическом устройстве.

[Карта управления и протокол](docs/PROTOCOL.md) · [Сторонние компоненты](docs/UPSTREAM.md) · [Отчёт о проверках](docs/ACCEPTANCE.md)
