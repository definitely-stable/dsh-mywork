# F-24 · `packController` идемпотентность: удалять одноимённый `.tgz` до пака

**Статус: READY_FOR_REVIEW.** Гейт выполнен: `node scripts/pack.mjs` дважды подряд → **EXIT 0 / 0**, в `packages/controller` **0** файлов `.tgz`. Дефект воспроизведён на до-фиксовой версии файла и объяснён механизмом.

## Изменённые пути

- Modify `scripts/pack.mjs` — экспортирован `tarballName(manifest)`; одноимённый `.tgz` удаляется **до** пака в обоих каталогах; пак идёт с `--pack-destination <outDir>`; проверка идёт по **детерминированному целевому пути**, а не по разнице множеств имён.
- Create `tests/scripts-pack-idempotent.test.mjs` — 2 теста на реальном пакере.

## Воспроизведение дефекта

До-фиксовая версия `scripts/pack.mjs` восстановлена из `HEAD` во временный `scripts/.f24-legacy-pack.mjs` (удалён в том же заходе), затем:

```
New-Item packages\controller\dsh-mywork-controller-0.1.0.tgz -ItemType File -Force
node scripts/.f24-legacy-pack.mjs
```

Результат — **ровно тот отказ, что описан в плане**:

```
Error: pack: expected exactly one new tarball in H:\Repo\DSH-MyWork\packages\controller, found []
EXIT=1
```

Механизм подтверждён замером, а не рассуждением: множество имён `.tgz` в каталоге **до** и **после** пака совпадает (`name_set_unchanged = True`), потому что `pnpm pack` перезаписывает версионно-детерминированное имя. Разница множеств имён при детерминированном имени не может быть непустой — дефект системный.

**Точность воспроизведения.** Файл-харнесс отличался от `HEAD`-версии на одно намеренное изменение: `logName: 'pnpm-pack-legacy'` вместо `'pnpm-pack'` (чтобы не затирать лог настоящего прогона). Это ровно +7 символов, что совпало с измеренной разницей длин тел (2434 против 2427). Остальные строки тела сверены с `git show HEAD:scripts/pack.mjs` построчно и совпадают.

## Таблица «команда → exit code → наблюдение»

| Команда | exit code | Наблюдение |
|---|---|---|
| `New-Item packages\controller\dsh-mywork-controller-0.1.0.tgz -Force` | 0 | `tgz_count = 1`, `names_before = [dsh-mywork-controller-0.1.0.tgz]` |
| `node scripts/.f24-legacy-pack.mjs` (до-фиксовая логика) | **1** | `pack: expected exactly one new tarball … found []`; `names_after` = `names_before` |
| `node --test --test-isolation=none tests/scripts-pack-idempotent.test.mjs` | **0** | `ℹ tests 2 / ℹ pass 2 / ℹ fail 0` |
| `node scripts/pack.mjs` (прогон 1) | **0** | `…\.tmp\pack\dsh-mywork-controller-0.1.0.tgz` |
| `node scripts/pack.mjs` (прогон 2) | **0** | тот же путь; повтор не падает |
| `Get-ChildItem packages\controller -Filter *.tgz` | 0 | **count = 0** — гейт F-24 |
| `Get-ChildItem .tmp\pack -Filter *.tgz` | 0 | `dsh-mywork-controller-0.1.0.tgz 224863 b` (непустой) |

Проверка `corepack pnpm pack --help` → 0 и содержит `--pack-destination <PACK_DESTINATION>`, поэтому фолбэк «удалить одноимённый файл» применён как дополнительная страховка, а не как основной путь.

## Ограничения

- `--pack-destination` есть в pnpm 12.4.2 (проверено в `--help`). На более старом pnpm флаг может отсутствовать; тогда сработает удаление одноимённого файла, но целевой путь придётся искать в `controllerDir`. Этот путь **не реализован** и не проверен.
- Тесты запускают настоящий `pnpm pack` (2 и 1 раз), поэтому занимают ~1 с и требуют рабочего лаунчера из F-23. Это сознательно: дефект жил во взаимодействии с `pnpm pack`, а не в чистой функции.
- Проверка «искать любой `.tgz`» сознательно **не** введена (план запрещает): она скрыла бы настоящую ошибку пака.

## Что НЕ проверено

- Не проверялось поведение при `outDir` вне репозитория и при относительном `--pack-destination`.
- Не проверялось, что делает `pnpm pack`, если целевой файл занят другим процессом (Windows-блокировка) — удаление может упасть.
- Второй тест (`a leftover same-named tarball …`) оставляет за собой удалённый пакером файл; отдельной уборки `.tmp/pack` тесты не делают.
