# фронт keetsta.me/mk1

модуль сайта для визитки mk-1: терминал по Web Serial, прошивка по WebUSB (последний релиз и свой `.uf2`, как у Flipper), try it с шеллом в WebAssembly, подсказки по ОС, если браузер не может. плата: `~/Downloads/mk1-card`, шелл и протокол: подмодуль `shell/` (`keetsta/mk1-shell`, его `SPEC.md`), сайт: `keetsta/keetsta-website`. описание и команды: `README.md`.

## правила

- дизайн по правилам сайта (`keetsta-website/CLAUDE.md`): никакого свечения (горящий светодиод — плоский цвет), только иконки react-icons, токены сайта, текст не мельче ~12px, переходы через `--ease`. тексты интерфейса на английском и строчными.
- `src/mk1/shell/core.ts`, `serial/osc.ts`, `flash/uf2.ts`, `flash/picoboot.ts`, `flash/releases.ts` гоняются тестами в Node без сборки (стирание типов): никаких `enum` и свойств-параметров конструктора, импорты между ними с `.ts`.
- `src/mk1/shell/mk1-shell.wasm` собранный и лежит в git: после обновления подмодуля `shell/` — `npm run wasm` и коммит обоих.
- `src/mk1/preview/geometry.ts` генерируется из платы (`npm run geometry`), руками не править.
- после изменений: `npm run build` (tsc strict) и `npm test` без ошибок, вид проверять `tools/shot.mjs` (системный Chrome, светлая и тёмная тема, телефон).
