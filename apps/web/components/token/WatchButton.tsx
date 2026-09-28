"use client";

import { Button } from "@peakpump/ui/Button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { SignInDialog } from "@/components/social/SignInDialog";
import { useSession } from "@/hooks/useSession";
import { useWatchlist, watchlistKey } from "@/hooks/useWatchlist";

// The save toggle: one WatchlistItem row, idempotent
// both ways — the server answers 200 whether the row was already there or
// already gone, so the button's optimistic flip is the only state that matters
// and a repeat click never lands on an error. The viewer's own watchlist is
// the truth the flip is predicted against — the shared query
// (hooks/useWatchlist), so the flip updates the same cache entry the home
// page's tab and the profile page render.

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function WatchButton({ market }: { market: Address }) {
  const { address: viewer, pending } = useSession();
  const client = useQueryClient();
  const [signInOpen, setSignInOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useWatchlist(viewer);

  const isSaved =
    viewer !== null && (list.data ?? []).some((saved) => sameAddress(saved, market));

  const toggle = useMutation({
    mutationFn: async () => {
      const response = isSaved
        ? await fetch(`/api/watchlist/${market}`, { method: "DELETE" })
        : await fetch("/api/watchlist", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ market }),
          });
      if (!response.ok) throw new Error("The save did not go through. Try again.");
    },
    // Optimistic flip with rollback, the same contract as the follow button:
    // the button answers at once and the server's refusal restores what it
    // last said was true. The cache entry is the address list itself, so the
    // flip writes the list's own shape.
    onMutate: async () => {
      if (viewer === null) return;
      await client.cancelQueries({ queryKey: watchlistKey(viewer) });
      const previous = client.getQueryData<Address[]>(watchlistKey(viewer));
      client.setQueryData(watchlistKey(viewer), (old: Address[] | undefined) => {
        if (old === undefined) return old;
        return isSaved
          ? old.filter((saved) => !sameAddress(saved, market))
          : [...old, market];
      });
      return { previous };
    },
    onError: (error, _void, context) => {
      if (viewer !== null && context?.previous !== undefined) {
        client.setQueryData(watchlistKey(viewer), context.previous);
      }
      setNotice(error.message);
    },
    onSuccess: () => {
      setNotice(null);
    },
  });

  if (viewer === null && !pending) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="text-small text-pp-text-muted">
            Sign in to save a market. Saving needs a session; reading needs none.
          </p>
          <div>
            <Button size="sm" onClick={() => setSignInOpen(true)}>
              Sign in
            </Button>
          </div>
        </div>
        <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant={isSaved ? "secondary" : "primary"}
        disabled={toggle.isPending || list.isPending}
        onClick={() => toggle.mutate()}
      >
        {isSaved ? "Saved" : "Save to watchlist"}
      </Button>
      {notice !== null ? <p className="text-small text-pp-down" role="status">{notice}</p> : null}
    </div>
  );
}
