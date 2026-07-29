import { getCatalogueEntry } from '@/arcade/catalogue';
import { getArcadeMachine } from '@/lib/arcade-machines-config';

import { ArcadeGameShell } from './ArcadeGameShell';
import { ArcadeMachinePanel } from './ArcadeMachinePanel';

/**
 * A dedicated machine whose game is not built yet — the pool table, the air
 * hockey table.
 *
 * One component, used by the room and by the DEV harness, so the panel a
 * reviewer looks at is the panel a player gets. Its whole job is to be ABOUT
 * THE RIGHT GAME: the title, the sentence and the artwork all come from the
 * machine and from that machine's own registry entry, so a pool table can only
 * ever talk about pool.
 *
 * There is no Start control, because there is nothing to start, and no
 * catalogue, because a dedicated machine is not a menu. The single dismiss
 * control returns to the arcade room.
 */

interface ArcadeDedicatedPreviewProps {
  readonly open: boolean;
  /** The machine the player walked up to. */
  readonly machineId: string;
  /** The registry id of the game this machine is for. */
  readonly experienceId: string;
  readonly onClose: () => void;
}

export function ArcadeDedicatedPreview({
  open,
  machineId,
  experienceId,
  onClose,
}: ArcadeDedicatedPreviewProps) {
  const machine = getArcadeMachine(machineId);
  const entry = getCatalogueEntry(experienceId);

  /*
    The fallbacks exist for one case: a machine pointing at a registry id that
    no longer exists. Saying "this machine is not ready" is honest; saying
    nothing, or borrowing another game's copy, is not.
  */
  const title = entry?.title ?? machine?.displayName ?? 'Arcade Machine';
  const blurb =
    entry?.shortDescription ?? 'This machine is not ready to play yet. Come back another day.';

  return (
    <ArcadeGameShell
      open={open}
      onClose={onClose}
      title={title}
      description={machine?.displayName}
      machineId={machineId}
      surface="notice"
      closeLabel="Close"
      closeAriaLabel="Close and go back to the arcade"
      contentClassName="flex flex-col"
    >
      <ArcadeMachinePanel displayName={title} blurb={blurb} image={machine?.src} />
    </ArcadeGameShell>
  );
}
