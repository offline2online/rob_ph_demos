/* PLAYLIST SETTINGS panel (ticket, 27 Sep 2026): the default playlist's own
   settings, shown last in the panel list, in the same collapsible-panel
   format as Phantom Zone / Enabled Features / Multi-Zone Layout — a "Default
   settings" tab holds the fields (room for another tab later, if this ever
   needs one).

   Editable here only while the default playlist is still a local, unsaved
   draft (DisplayTypeForm's `defaultPlaylistIsNew`) — true for a brand-new
   display type (its default playlist doesn't exist until Save creates it),
   and also for an existing display type whose default was just swapped via
   "+ Add new playlist". Once the playlist is real, Playlist Management is
   the only place that edits it (ticket, 26 Sep 2026) and this panel becomes
   a read-only preview with a comment and a CTA there.

   Its collapsed header carries the same summary pill the other panels do
   ("Default settings", or "N settings changed"), and the Playlist
   Management CTA sits inside the panel rather than on its header, so it
   isn't competing with the rest of the form (failed-testing feedback,
   27 Sep 2026). */
import { Button, Tabs } from 'antd'
import type { Playlist } from '@ph-dsp/types'
import { useNavigate } from 'react-router-dom'
import { CollapsiblePanel } from '../../../shared/CollapsiblePanel'
import { Icon } from '../../../shared/Icon'
import { SummaryChip } from '../../../shared/SummaryChip'
import { T } from '../../../theme/phTheme'
import { PlaylistStyleFields } from '../../playlist-management/PlaylistStyleFields'
import { styleSummary } from '../model'
import type { PlaylistOption } from '../DisplayTypeForm'

export function PlaylistSettingsPanel({ playlist, editable, onUpdate, open, onToggle }: {
  playlist: PlaylistOption | undefined
  /* True while `playlist` is still a local draft, with no Playlist
     Management row of its own to edit it from yet. */
  editable: boolean
  onUpdate: (fn: (p: Playlist) => Playlist) => void
  open: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  if (!playlist) return null
  const asPlaylist: Playlist = {
    id: playlist.id, name: playlist.name, autoCreatedFor: playlist.autoCreatedFor,
    playlistSettings: playlist.playlistSettings ?? {}, assignments: [],
  }
  return (
    <CollapsiblePanel
      title="Playlist Settings"
      open={open}
      onToggle={onToggle}
      summary={styleSummary(asPlaylist).map(({ key, ...c }) => <SummaryChip key={key} {...c} />)}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1" style={{ fontSize: 12.5, color: T.muted }}>
        <span>
          {editable
            ? 'This new playlist will be created with these settings. Edit them from Playlist Management once it’s been saved.'
            : 'Settings managed within Playlist Management.'}
        </span>
        <Button color="primary" variant="text" size="small" className="px-1" onClick={() => navigate('/playlists')}>
          Playlist Management<Icon name="arrow_forward" size={13} />
        </Button>
      </div>
      <Tabs
        items={[{
          key: 'default',
          label: 'Default settings',
          children: <PlaylistStyleFields p={asPlaylist} update={onUpdate} readOnly={!editable} />,
        }]}
      />
    </CollapsiblePanel>
  )
}
