export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 w-full text-xs font-medium text-rose-600">
      {message}
    </p>
  );
}
