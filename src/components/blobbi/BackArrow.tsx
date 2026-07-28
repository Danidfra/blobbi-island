import { cn } from '@/lib/utils';

/**
 * The "leave this room" arrow, shared by every interior location.
 *
 * Extracted from `InteractiveElements.tsx` unchanged so the arcade can render it
 * without importing from the file that renders the arcade.
 */
export function BackArrow({ className, onClick }: { className?: string; onClick?: () => void }) {
  return (
    <div
      className={cn(
        'cursor-pointer select-none transition-all duration-300 ease-out hover:scale-110 active:scale-95',
        className,
      )}
      data-block-move
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <path
          d="M19 12H5M5 12L12 19M5 12L12 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
