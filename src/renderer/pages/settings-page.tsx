import { useEffect, useState } from 'react'
import { LogoutButton } from '@/components/buttons/logout-button'
import { SaveBlindPeersButton } from '@/components/buttons/save-blind-peers-button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDrive } from '@/context/drive-context'

export function SettingsPage() {
  const { status } = useDrive()
  const [blindKeys, setBlindKeys] = useState((status.blindPeerKeys || []).join('\n'))

  useEffect(() => {
    setBlindKeys((status.blindPeerKeys || []).join('\n'))
  }, [status.blindPeerKeys])

  return (
    <div className='mx-auto max-w-[760px]'>
      <p className='meta-label text-leaf'>Preferences</p>
      <h2 className='display-heading m-0 mt-2 text-[34px]'>Settings</h2>

      <div className='panel-surface mt-6 overflow-hidden'>
        <div className='iris-wash px-5 py-4'>
          <h3 className='display-title m-0 text-lg'>Identity</h3>
        </div>
        <div className='grid gap-3 border-t border-line p-5'>
          <code className='break-all font-mono text-xs text-soft'>{status.identity || '—'}</code>
          <p className='m-0 text-sm text-mute'>
            Drive key: <code className='font-mono text-xs text-leaf'>{status.driveKey || '—'}</code>
          </p>
          <LogoutButton />
        </div>
      </div>

      <div className='liquid-panel mt-4 grid gap-3 p-5'>
        <h3 className='meta-label m-0 text-leaf'>Blind peers</h3>
        <p className='m-0 text-sm leading-relaxed text-mute'>
          Pin encrypted replicas to blind peers so files stay reachable when your devices are
          offline. Paste one public key per line.
        </p>
        <div className='grid gap-2'>
          <Label htmlFor='blind-keys' className='sr-only'>
            Blind peer keys
          </Label>
          <Textarea
            id='blind-keys'
            rows={4}
            placeholder='z32… blind peer keys'
            value={blindKeys}
            onChange={(e) => setBlindKeys(e.target.value)}
          />
        </div>
        <SaveBlindPeersButton value={blindKeys} />
      </div>
    </div>
  )
}
