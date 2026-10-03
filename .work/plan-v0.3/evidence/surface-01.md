surface-01 · инвентаризация `data-dsh-*` в DSH-checkout `C:\Reposit\deepseek-harness\deepseek-harness` · только чтение
КОМАНДА prod (даёт 7): `$r='C:\Reposit\deepseek-harness\deepseek-harness'; (Get-ChildItem "$r\packages" -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\lib\\' -and $_.FullName -match '\\src\\' } | Select-String 'data-dsh-[a-zA-Z-]+' -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum`
КОМАНДА tree (даёт 32): то же, но `Get-ChildItem "$r\packages","$r\apps"` и фильтр `-notmatch '\\node_modules\\|\\dist\\|\\lib\\'`
ФАКТЫ:
1) `packages/client/ui-primitives/src/focus.ts:7` — `* The theme suppresses outlines while data-dsh-automatic-focus is present; borders and shadows remain intact.`
2) `packages/client/ui-primitives/src/focus.ts:15` — `element.removeAttribute('data-dsh-automatic-focus')`
3) `packages/client/ui-primitives/src/focus.ts:24` — `element.setAttribute('data-dsh-automatic-focus', '')`
4) `packages/client/ui-theme/src/styles/base.css:29` — `[data-dsh-automatic-focus]:focus,`
5) `packages/client/ui-renderer/src/client/index.ts:66` — `'data-dsh-boot': '',`
6) `packages/client/ui-renderer/src/client/index.ts:73` — `const boot = container.querySelector<HTMLElement>(':scope > [data-dsh-boot]')`
7) `packages/client/web/src/boot-page.ts:35` — `this.root.dataset.dshBoot = ''` (литерала `data-dsh-` в файле нет — атрибут рождается через `dataset`)
8) `packages/client/web/src/boot-page.ts:39` — `this.spinner.dataset.dshBootSpinner = ''` (так же; продюсер `data-dsh-boot-spinner`)
9) `packages/client/ui-renderer/tests/ui-renderer.client.spec.tsx:71` — фрагмент строки: `data-dsh-boot-spinner=""` (первое вхождение имени; в `src/**` имени нет)
10) `packages/client/ui-primitives/tests/atoms.client.spec.tsx:236` — `expect(alpha.getAttribute('data-dsh-automatic-focus')).toBe('')`
11) `packages/client/ui-theme/README.md:66` — фрагмент: `` `base.css` suppresses only the outline of focused elements marked `data-dsh-automatic-focus` ``
12) СЧЁТ (а): `packages/**/src/**` = **7** совпадений / 7 строк / 3 файла (`ui-primitives/src/focus.ts` ×3, `ui-renderer/src/client/index.ts` ×2, `ui-theme/src/styles/base.css` ×2); `packages`+`apps` без node_modules|dist|lib = **32** / 31 / 13; весь checkout без node_modules|.git|.pnpm-store|dist|lib|.dsh-build|snapshots = **34** / 33 / 15 (вне packages+apps всего 2 — `.agents\notes\implemented\testing\2026-07-24-web-gui-browser-e2e-lane.md:83` и `.zh.md:83`).
13) ИМЕНА (б), 3 шт., счёт по дереву packages+apps: `data-dsh-automatic-focus` ×18, `data-dsh-boot` ×8, `data-dsh-boot-spinner` ×6.
14) НАЗНАЧЕНИЕ (в) / первое вхождение: `data-dsh-automatic-focus` — `focus.ts:7` — маркер «автофокус без обводки», ставит `focusWithoutRing`, гасит `base.css`; `data-dsh-boot` — `ui-renderer/README.md:50` (в src — `src/client/index.ts:66`) — маркер kernel-owned loading DOM, по нему `mountApp` выбирает `hydrateRoot`; `data-dsh-boot-spinner` — `ui-renderer.client.spec.tsx:71`, продюсер `boot-page.ts:39` — узел спиннера прогресса загрузки плагинов.
15) (г) `data-mywork` и `data-mw` в DSH-исходниках: **0** совпадений (`Select-String -SimpleMatch` по 23 496 файлам checkout, исключая node_modules/.git/.pnpm-store/.dsh-build/snapshots).
16) (е) `docs/**`: `data-dsh` → **0**; `semantic attrs|semantic-attrs|semantic attributes` → **0** (`semantic` встречается 118 раз, ни разу про DOM-атрибуты). В `.agents/**` строка `data-dsh` есть только в `.agents\notes\implemented\testing\2026-07-24-web-gui-browser-e2e-lane.md:83` (+ `.zh.md:83`).
17) `.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md:83` — `**A client `data-dsh-busy` settled signal.** Deferred: the host-side `whenIdle` barrier plus stable DOM polls cover the current scenarios.` (предложено и отложено; в коде отсутствует — 0 вхождений `data-dsh-busy` в src).
18) `apps/web/tests/smoke-real.e2e.ts:9` — фрагмент: `selectors are unreliable — anchor on data-* attributes (data-variant /`; `:12` — `data-* for anything new.` (единственная найденная конвенция про `data-*` — тестовые селекторы, не правило префикса для плагинов).
19) `.agents/skills/dsh-client-ui-ux/SKILL.md:52` — фрагмент: `Add a scoped [data-platform='darwin'] override on the page's own inset instead` (страничный оверрайд, префикса не требует).
20) Механизм/skill/документ, предписывающий плагину собственный префикс атрибутов: **не найдено** (поиски выше + `prefix` рядом с `data-` по 12 602 файлам без node_modules/.git/.pnpm-store/dist/lib/.dsh-build/snapshots; в src ~250 разных `data-*` имён идут без префикса).
21) Справочно, вне DSH-checkout: `.work\plan-v0.3\10-DECISIONS.md:71` — ``| D18 | Форма UI-пакета и место view-состояния | [АГЕНТ] | Отдельный `@dsh-mywork/web`, `store` слота — источник view-состояния, префикс `data-mw-*` |``
22) Справочно, вне DSH-checkout: `.work\plan-v0.3\20-STEPS-foundation.md:1486` — ``1. Тест (падающий): ни один `data-*`-атрибут в `packages/web/src/**` не начинается с `data-dsh-`; все начинаются с `data-mw-` (D18).``
23) Справочно, вне DSH-checkout: `.work\analysis\2026-09-26\verify\C-claims-verification.md:109` — фрагмент: `атрибута `data-dsh-panel-entry`, файла `contracts/semantic-attrs-v1.md` и вообще какого-либо «semantic-attrs»-контракта панелей в DSH нет`.
НЕ ПРОВЕРЕНО:
- `apps/**/src/**` отдельно от `packages` не считал: числа 32/34 суммарные по packages+apps, «prod»-число 7 относится строго к `packages/**/src/**`.
- Бандлы, node_modules, lib-сборки по указанию не проверял; знаю лишь, что в `packages\**\lib\` лежат копии исходников (+18 совпадений: 34 → 52 при включении `lib`).
- Git-история и когда-либо удалённые атрибуты, живой DOM запущенного GUI, рантайм-чтение `data-*` (инспектор, слоты) — не проверял.
- Префиксы `data-mywork`/`data-mw` вне DSH-checkout и рабочей папки (чужие репозитории, маркетплейс, установленный профиль) — не проверял.
ЧТО ЭТО ЗНАЧИТ ДЛЯ ПЛАНА:
- Пространство `data-dsh-*` занято служебными маркерами shell/boot (3 имени, 7 литералов в src), но это не семантический контракт и не публичный API: готового `contracts/semantic-attrs-v1.md`-контракта в нём нет.
- Часть `data-dsh-*` пишется через `dataset` (`boot-page.ts:35,39`), поэтому литеральный grep систематически недосчитывает: «0 по литералам» ≠ «атрибута нет» — нужен поиск и по `dataset.<camelCase>`.
- Ни `docs/**`, ни skills не предписывают плагину свой префикс: ~250 разных `data-*` имён в src идут вообще без префикса, единственные конвенции — тестовые селекторы и `data-platform`-оверрайды.
- В рабочей папке уже зафиксированы D18 (`data-mw-*`) и F-59 (тест «ни один `data-dsh-*`»), а прошлая верификация независимо пришла к тому же выводу об отсутствии semantic-attrs-контракта; мой счёт эти документы не опровергает.
