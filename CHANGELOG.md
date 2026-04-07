# Changelog

## 0.3.1

- feat: añadir campos `estimate_point`, `type` y `module` a WorkItem, CreateWorkItemInput y UpdateWorkItemInput

## 0.3.0

- feat: soporte completo relations API (Plane v1.3.0)
- feat: ESLint 10 + typescript-eslint flat config

## 0.2.2

- fix: mocks unitarios reflejan formato real API + tests addWorkItems

## 0.2.1

- fix: addWorkItems body field `work_items` → `issues` en modules y cycles
- fix: build output iba a `dist/src/` en vez de `dist/`

## 0.2.0

- fix: corregir endpoints API y alinear con convención #1076
- feat: tests de integración contra Plane real

## 0.1.1

- ci: dual publish a Verdaccio y npmjs
- fix: test script usa `dist/tests/` en vez de glob

## 0.1.0

- feat: core — PlaneClient con retry/hooks, PlaneApiError
- feat: resources — WorkItems, Modules, Cycles, States, Labels, Intake
- ci: pipeline tag-triggered con typecheck, test y publish
