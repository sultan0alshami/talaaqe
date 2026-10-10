export class OnboardingError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); this.name = "OnboardingError"; }
}
