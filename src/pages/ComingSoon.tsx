import { Compass } from "lucide-react";

export default function ComingSoon({ title, stage }: { title: string; stage: string }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center justify-center px-4 py-20 text-center sm:px-8 sm:py-32">
      <Compass className="h-10 w-10 text-brass" strokeWidth={1.25} />
      <h1 className="mt-4 font-display text-2xl text-parchment">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-parchment/50">
        Charted for a later leg of the voyage — arriving in {stage}.
      </p>
    </div>
  );
}
