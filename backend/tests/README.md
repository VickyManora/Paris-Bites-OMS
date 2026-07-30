# Tests

```
tests/
├── unit/          domain + use cases, with fakes for every port. No I/O.
└── integration/   repositories against real Postgres; HTTP against createApp().
```

## Unit tests

Use cases take their dependencies as port interfaces, so a fake is a plain object:

```ts
const users: IUserRepository = {
  findByEmail: async () => null,
  create: async (data) => User.fromPersistence({ ...data, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }),
  // ...only the methods this test exercises
};

const result = await new CreateUserUseCase(users, hasher).execute(input);
```

No database, no Express, no mocking library. That is the return on the dependency
rule.

## Integration tests

Repositories are tested against a real Postgres — mocking Prisma here would only
test the mock. Point `DATABASE_URL` at a scratch database and reset between runs.

For HTTP, build the app with fakes injected and drive it in-process:

```ts
const app = createApp(createContainer({ userRepository: fakeUserRepository }));
```

`createContainer` accepts partial overrides precisely for this.

`vitest.config.ts` sets `fileParallelism: false`, since integration tests share
one schema and would otherwise race.
