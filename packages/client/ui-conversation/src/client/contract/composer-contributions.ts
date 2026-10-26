/** Plugin-owned text submitted after the editor's text without changing its document. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Frozen contribution reserved for one ordinary message admission. */
export interface ComposerContribution {
  /** Complete nonempty model-visible text, also retained in the user message log. */
  readonly text: string
  /**
   * Release the reservation exactly once. Success means Host admission, not model completion.
   * Error retains unsent work; cancellation means the Session input was released.
   * @param outcome - admission result or input disposal.
   */
  settle(outcome: 'success' | 'error' | 'cancelled'): void
}

/** Session-local producer registered by its owning plugin effect. */
export interface ComposerContributionSource {
  /** Whether the producer has content for the next ordinary message. */
  readonly pending: ObservableSnapshot<boolean>
  /**
   * Synchronously reserve the currently pending content and publish its removal from pending.
   * The returned text must remain unchanged until settlement. A thrown capture leaves this
   * producer's pending content unchanged; the composer rolls back earlier reservations.
   * Slash commands do not capture contributions.
   * @returns reservation owned by the composer until admission or disposal.
   */
  capture(): ComposerContribution
}
