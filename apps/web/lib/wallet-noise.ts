// One class of rejection reaches the page with no handler anywhere in the call
// stack, and no try/catch in this app can reach it.
//
// wagmi's Hydrate calls onMount() bare inside an effect with no .catch(), and
// @wagmi/core's onMount calls reconnect(config) with neither await nor .catch().
// reconnect() itself is safe — every await inside it is guarded and
// injected.isAuthorized() returns false rather than throwing — but
// injected.connect() registers onAccountsChanged, onChainChanged and onDisconnect
// as raw EIP-1193 listeners through provider.on(). Those are async methods, so each
// invocation returns a promise the extension never holds and wagmi never sees, and
// inside them sit unguarded getProvider, getAccounts and getChainId calls. When the
// extension fires disconnect during page load with its background port still coming
// up, that internal request rejects into nothing at all.
//
// So the only place left to answer it is the window event, and the predicate has to
// be narrow enough that a real bug still gets through. Two conditions match; anything
// else is left alone, which means the browser's default report and any reporter
// attached to it still fire.
//
// One constraint on editing this file: Tailwind reads it as a candidate source and
// tokenizes prose, so a CSS property name left standing alone in a comment here can
// materialise a real utility rule in the stylesheet. Two of the property names the
// elevation rules in DESIGN.md forbid are gated in the build check, so a comment that
// spells one out costs a gate failure rather than a byte.

// The extension's own text. It appears nowhere in node_modules, so nothing in our
// dependency tree and nothing we wrote can produce this string.
const PROVIDER_MESSAGES = ["Failed to connect to MetaMask"] as const;

// EIP-1193 4900 Disconnected and 4901 ChainDisconnected: the provider lost its
// transport, which is the same failure arriving through a different surface. Every
// path in this app that can produce one of these has a handler already — connect()
// reports through its mutation, addChain() through its catch — so a 4900 that
// reaches an unhandledrejection event came from a listener nobody is awaiting.
const PROVIDER_CODES: ReadonlySet<number> = new Set([4900, 4901]);

// One cause hop and no further. The provider's error arrives as the rejection reason
// itself rather than wrapped, and every level this walk skips is a level at which a
// failure of ours could hide behind a wallet code.
function isProviderNoise(reason: unknown): boolean {
  for (let depth = 0; depth < 2; depth += 1) {
    if (typeof reason !== "object" || reason === null) return false;
    const node = reason as { code?: unknown; message?: unknown; cause?: unknown };

    if (typeof node.code === "number" && PROVIDER_CODES.has(node.code)) return true;
    if (
      typeof node.message === "string" &&
      PROVIDER_MESSAGES.some((text) => (node.message as string).includes(text))
    ) {
      return true;
    }

    reason = node.cause;
  }
  return false;
}

export function installWalletNoiseGuard(): () => void {
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    if (!isProviderNoise(event.reason)) return;
    // preventDefault suppresses the browser's own report and nothing else. The one
    // line left in its place keeps the event findable in the session where a wallet
    // connection is the actual subject of the debugging.
    event.preventDefault();
    console.debug("[peakpump] suppressed a wallet provider rejection", event.reason);
  };

  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => window.removeEventListener("unhandledrejection", onUnhandledRejection);
}
