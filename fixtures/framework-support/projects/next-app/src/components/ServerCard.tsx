import dynamic from "next/dynamic";

const Chart = dynamic(() => import("./Chart"));

export default async function ServerCard() {
  return <article><Chart /></article>;
}
