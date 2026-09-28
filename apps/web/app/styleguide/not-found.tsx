import { RouteNotFound } from "@/components/boundary/RouteNotFound";

export default function StyleguideNotFound() {
  return (
    <RouteNotFound
      title="That page does not exist"
      detail="The styleguide is one page, at /styleguide."
    />
  );
}
