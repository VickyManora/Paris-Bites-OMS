# Controllers

Thin adapters between HTTP and use cases. A controller does exactly four things:

1. Read already-validated input from `req` (body / params / query / `req.user`).
2. Call one use case.
3. Hand the result to a serializer.
4. Nothing else.

No business logic, no Prisma, no `try/catch` — errors propagate to
`errorHandler`, which is the single place failures become responses.

## Shape

```ts
export class AuthController {
  constructor(private readonly login: LoginUseCase) {}

  readonly signIn = asyncHandler(async (req, res) => {
    const result = await this.login.execute({
      email: req.body.email,
      password: req.body.password,
    });

    sendSuccess(res, result);
  });
}
```

Arrow-function properties are used so the handler can be passed to Express
without losing `this`.

## Route wiring

```ts
export function authRoutes(container: AppContainer): Router {
  const router = Router();
  const controller = new AuthController(container.loginUseCase);

  router.post('/login', authRateLimiter(), validate({ body: loginSchema }), controller.signIn);

  return router;
}
```

Middleware order per route: rate limit → authenticate → authorize → validate →
handler.
