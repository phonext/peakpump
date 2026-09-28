import { RouteNotFound } from "@/components/boundary/RouteNotFound";

export default function TokenNotFound() {
  return (
    <RouteNotFound
      title="No market at this address"
      detail="The address in the URL is not a curve this factory deployed."
    />
  );
}
