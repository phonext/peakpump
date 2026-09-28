import { RouteNotFound } from "@/components/boundary/RouteNotFound";

export default function ProfileNotFound() {
  return (
    <RouteNotFound
      title="No profile at this address"
      detail="The address in the URL is not one this product has anything to show for."
    />
  );
}
