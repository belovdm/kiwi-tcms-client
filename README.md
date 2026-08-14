# kiwi-tcms-client

Переиспользуемый TypeScript-клиент к JSON-RPC API [Kiwi TCMS](https://kiwitcms.org).

## Установка

```bash
npm install kiwi-tcms-client
```

Локальная разработка:

```bash
npm install
npm run build
```

Сборка кладёт JS и `.d.ts` в `dist/` (`dist/index.js`, `dist/client.js`, …).

## Использование

```ts
import { KiwiClient } from "kiwi-tcms-client";

const client = new KiwiClient({
  url: "https://tcms.example.com",
  token: process.env.KIWI_TOKEN!,
  project: "Payments",
  timeoutMs: 30_000,
});

await client.ping();
const projects = await client.projects.list({ query: "Pay", limit: 20 });
await client.versions.create({ value: "1.4.0" });
await client.builds.create({ name: "1.4.0-rc1", version: "1.4.0" });
const created = await client.cases.create({
  summary: "Login works",
  plan: 12,
  tags: "smoke,auth",
});
await client.cases.addComponent(created.created as never, "Auth");
await client.executions.addLink({
  execution_id: 9,
  name: "JIRA-148",
  url: "https://jira.example.com/148",
  is_defect: true,
});
const status = await client.runs.status(44);
```

`KiwiClient` группирует вызовы по сущностям, как `TestyClient`:

```ts
client.projects.list / create
client.versions.list / create
client.builds.list / create
client.planTypes / caseStatuses / executionStatuses / users / tags
client.plans.list / create / update / addCase / removeCase / tree / attachments
client.cases.search / get / create / update / addTag / addComponent / attachments / properties
client.runs.list / create / update / addCases / getCases / status / properties
client.executions.list / update / addLink / getLinks / attachments / properties
client.attachments.remove(id)
client.ping()
client.call("Bug.filter", [{}])
```

Низкоуровневый транспорт — `KiwiRpcClient`. Хелперы `extractId`, `extractName` и `firstId` нормализуют сериализацию Kiwi.

## Разработка

```bash
npm test
npm run typecheck
npm run build
```
