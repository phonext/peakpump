"use client";

import { Button } from "@peakpump/ui/Button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { useSession } from "@/hooks/useSession";
import { followingKey, followerKey, useFollowingList } from "@/hooks/useFollows";
import { SignInDialog } from "@/components/social/SignInDialog";

// The follow toggle: one row in Postgres, idempotent both ways — the
// server answers 200 whether the row was already there or already gone, so the
// button's optimistic flip is the only state that matters and a repeat click
// never lands on an error. A follow targets an address, and the viewer's own
// following list is the truth the flip is predicted against — the shared
// query (hooks/useFollows), so the flip updates the same cache entry the
// profile page renders.

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function FollowButton({ target }: { target: Address }) {
  const { address: viewer, pending } = useSession();
  const client = useQueryClient();
  const [signInOpen, setSignInOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useFollowingList(viewer);

  const isFollowing =
    viewer !== null && (list.data ?? []).some((address) => sameAddress(address, target));

  const toggle = useMutation({
    mutationFn: async () => {
      const response = isFollowing
        ? await fetch(`/api/follows/${target}`, { method: "DELETE" })
        : await fetch("/api/follows", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ address: target }),
          });
      if (!response.ok) throw new Error("The follow did not go through. Try again.");
    },
    // Optimistic flip with rollback, the same contract as posting a comment:
    // the button answers at once and the server's refusal restores what it
    // last said was true. The cache entry is the address list itself, so the
    // flip writes the list's own shape.
    onMutate: async () => {
      if (viewer === null) return;
      await client.cancelQueries({ queryKey: followingKey(viewer) });
      const previous = client.getQueryData<Address[]>(followingKey(viewer));
      client.setQueryData(followingKey(viewer), (old: Address[] | undefined) => {
        if (old === undefined) return old;
        return isFollowing
          ? old.filter((address) => !sameAddress(address, target))
          : [...old, target];
      });
      return { previous };
    },
    onError: (error, _void, context) => {
      if (viewer !== null && context?.previous !== undefined) {
        client.setQueryData(followingKey(viewer), context.previous);
      }
      setNotice(error.message);
    },
    onSuccess: () => {
      setNotice(null);
      // The flip is already in the viewer's following entry above. The target's
      // follower list is the other side of the same row, and the reader looking
      // at that profile has just seen the button pressed, so it is fetched now
      // rather than after the staleTime expires.
      void client.invalidateQueries({ queryKey: followerKey(target) });
    },
  });

  // A viewer never follows the address they are browsing as, and the button is
  // not a self-report tool.
  if (viewer !== null && sameAddress(viewer, target)) return null;

  if (viewer === null && !pending) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <p className="text-small text-pp-text-muted">
            Sign in to follow. Following needs a session; reading needs none.
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
        variant={isFollowing ? "secondary" : "primary"}
        disabled={toggle.isPending || list.isPending}
        onClick={() => toggle.mutate()}
      >
        {isFollowing ? "Following" : "Follow"}
      </Button>
      {notice !== null ? <p className="text-small text-pp-down" role="status">{notice}</p> : null}
    </div>
  );
}
