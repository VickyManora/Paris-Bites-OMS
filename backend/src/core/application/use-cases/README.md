# Use cases

One class per business operation, each implementing `IUseCase<TInput, TOutput>`
from `../ports/use-case.port.ts`.

Grouped in a subfolder per feature:

```
use-cases/
├── auth/
│   ├── login.use-case.ts
│   ├── refresh-token.use-case.ts
│   └── logout.use-case.ts
├── users/
│   ├── create-user.use-case.ts
│   └── list-users.use-case.ts
└── products/
```

## Rules

1. **Constructor injection only.** Dependencies are the port interfaces from
   `../ports/` and `domain/repositories/` — never a concrete class, never
   `PrismaClient`, never `express`.
2. **One public method: `execute`.** If a class needs two, it is two use cases.
3. **Inputs are already validated.** A zod schema at the HTTP boundary
   guarantees shape; the use case enforces *business* rules, not field formats.
4. **Return DTOs, not entities.** Mapping happens through
   `../mappers/`, which is what keeps `passwordHash` from ever reaching a client.
5. **Throw `DomainError` subclasses** for expected failures. The error middleware
   translates them to status codes; a use case never sets one.

## Shape

```ts
export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export class LoginUseCase implements IUseCase<LoginInput, LoginOutput> {
  constructor(
    private readonly users: IUserRepository,
    private readonly hasher: IHashService,
    private readonly tokens: ITokenService,
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    // ...
  }
}
```

Register the class in `infrastructure/container/container.ts` so controllers
receive it already constructed.
