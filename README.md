# FM-1 DJ

Две браузерные деки и прошивка USB-контроллера для M-VAVE FM-1. Браузер декодирует и микширует локальные файлы. FM-1 принимает звук Cue по USB Audio и обменивается командами и состоянием по USB MIDI.

## Запуск

Для запуска [FM-1 DJ на GitHub Pages](https://teutonick.github.io/fm1-dj/) достаточно Chrome на macOS. Для локальной сборки выполните `npm ci --ignore-scripts`, затем `npm run build` и `npm run preview`. В GitHub Pages установите источник **GitHub Actions**. Workflow **Web checks and GitHub Pages** публикует `dist` из ветки `main`.

В библиотеке добавьте WAV, MP3 или FLAC, затем загрузите треки на A и B. Кнопка **Add demo tracks** импортирует два встроенных тестовых файла. [Beacon, 124 BPM](public/demo/Beacon-124.wav) и [Afterglow, 128 BPM](public/demo/Afterglow-128.wav) — сгенерированные метрономные фрагменты, CC0-1.0. Для проверки фазового Sync включите A, нажмите Sync на B и запустите B. В инструментах деки можно исправить BPM и положение сетки.

## Master и Cue

1. Установите динамики MacBook или внешний выход как системный Master в macOS. Подключите FM-1 по USB и вставьте проводные наушники в FM-1. Начните с малой громкости MASTER на корпусе.
2. Нажмите **Connect FM-1**, разрешите MIDI с SysEx. В настройках приложения на вкладке Audio выберите Master и отдельный Cue **FM-1 DJ**. Если Chrome скрывает имена, кнопка получения разрешения запрашивает доступ к аудиовходу и сразу освобождает его.
3. Нажмите **Enable Cue Output**. В Hardware diagnostics отдельно проверьте **Test Master** и **Test headphones**.
4. Установите Crossfader в A. Запустите обе деки и включите PFL B. В Master должен остаться A, а в наушниках должен появиться B. Повторите зеркально, затем включите оба PFL и проверьте Cue/Master.
5. Если FM-1 отключился, приложение заглушает Cue. После подключения проверьте название выхода и снова включите Cue.

## Firmware

Установочный файл доступен в [релизе 0.1.0](https://github.com/Teutonick/fm1-dj/releases/tag/v0.1.0). Исходники в [firmware/dj](firmware/dj). `firmware/build.sh --host` собирает симулятор. Для файла устройства используйте Linux x86-64 или macOS с запущенным Docker/Podman, Python 3.12 и Pillow с Raqm. Выполните `firmware/base/tools/setup_toolchain.sh --only jieli,ac79-sdk` после первой host-сборки, затем `firmware/build.sh --release 0.1.0`. Установочный пакет создаётся в `firmware/dj/build`. Те же шаги выполняет workflow **FM-1 DJ firmware**.

### Установка 0.1.0

1. Скачайте `fm1-dj-0.1.0.fwsc` и `fm1-dj-0.1.0.fwsc.sha256` из релиза, затем выполните `shasum -a 256 -c fm1-dj-0.1.0.fwsc.sha256` в папке загрузки. Скачайте штатный пакет M-VAVE из раздела восстановления, прежде чем начинать запись.
2. Запустите FM-1 в рабочем режиме, подключите кабель USB с передачей данных и закройте другие программы, занявшие USB MIDI. Обычная установка использует штатный механизм обновления и не требует отдельной замены загрузчика.
3. В среде Python с `mido` и `python-rtmidi` выполните `python3 firmware/base/tools/fm1_install.py --info`, затем `python3 firmware/base/tools/fm1_install.py /путь/к/fm1-dj-0.1.0.fwsc`. Дождитесь сообщения о завершении и перезапуска, после чего найдите **FM-1 DJ** в Audio MIDI Setup. Если установщик сообщает о версии M-VAVE Open, сначала верните штатный пакет M-VAVE и повторите установку.

### Возврат штатной прошивки

Откройте раздел **Back to the stock firmware** в [инсталляторе fm1-base](https://charlesvestal.github.io/fm1-base/install/). Скачайте `FM-1.fwsc` по ссылке из этого раздела и выберите файл там же. Подключите FM-1, дождитесь результата проверки файла и нажмите **Install the stock firmware**. Дождитесь перезапуска до отключения кабеля. Если FM-1 не загружается, используйте процедуру из раздела **If the FM-1 no longer starts** и [инструменты восстановления felucca-bsp](https://github.com/hugelton/felucca-bsp/tree/7b77bfbce8e0d185461a79d164c893551492ded1/tools).

[Карта управления и протокол](docs/PROTOCOL.md) · [Сторонние компоненты](docs/UPSTREAM.md) · [Отчёт о проверках](docs/ACCEPTANCE.md)
