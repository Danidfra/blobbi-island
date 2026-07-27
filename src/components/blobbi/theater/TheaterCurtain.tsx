import { cn } from '@/lib/utils';

interface TheaterCurtainProps {
  /** Driven by the theater state machine — never by hover, never by touch. */
  open: boolean;
}

/**
 * The theater's two curtain layers.
 *
 * **Yellow curtain — movable.** It rises exactly when the state machine says a
 * video is ready and falls when the video is replaced or the seat is left. It
 * used to slide on `mouseenter`, which meant three wrong things at once: the
 * screen was revealed to anyone brushing past with a mouse, it was permanently
 * shut on touch devices (the parent passed an explicit `isHovered`, which
 * bypasses `InteractiveElement`'s own touch fallback), and it re-closed the
 * moment the pointer left — mid-film. Curtains follow the film, not the cursor.
 *
 * **Red curtain — static.** Painted scenery framing the proscenium. Unchanged.
 *
 * The whole block is `pointer-events-none`: it is decoration in front of the
 * screen, and swallowing clicks would stop the Blobbi from walking underneath it.
 */
export function TheaterCurtain({ open }: TheaterCurtainProps) {
  return (
    <div
      data-theater-curtain
      data-curtain-open={open ? 'true' : 'false'}
      className="absolute w-full h-[55%] top-[5%] overflow-hidden pointer-events-none select-none"
    >
      <div className="w-[88%] h-auto absolute left-1/2 -translate-x-1/2 top-0">
        <div
          className="transition-transform duration-700 ease-in-out"
          style={{ transform: open ? 'translateY(-100%)' : 'translateY(0)' }}
        >
          <img
            src="/assets/locations/stage/curtain.png"
            alt=""
            aria-hidden
            draggable={false}
            className={cn('w-full h-full object-contain')}
          />
        </div>
      </div>
      <img
        src="/assets/locations/stage/red-curtain.png"
        alt=""
        aria-hidden
        draggable={false}
        className="w-[90%] h-auto relative left-[5%] top-0"
      />
    </div>
  );
}
