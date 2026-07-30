/**
 * Shape every use case implements: one public method, one input, one output.
 *
 * The single-method contract is what keeps controllers thin — a controller
 * validates, calls `execute`, and serialises. It also makes the
 * interface-segregation principle automatic, since no consumer can depend on
 * more of a use case than the one operation it needs.
 *
 * Use `void` for use cases that take no input.
 */
export interface IUseCase<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}
