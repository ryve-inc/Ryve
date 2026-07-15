import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function ShareUploadButton() {
  const { activeShare, uploadFiles, showToast } = useDrive()
  if (!activeShare?.writable) return null

  return (
    <Button asChild>
      <label className="cursor-pointer">
        Upload to share
        <input
          type="file"
          multiple
          hidden
          onChange={(e) => {
            uploadFiles(e.target.files || [], { share: true }).catch((err) =>
              showToast(err.message)
            )
            e.target.value = ''
          }}
        />
      </label>
    </Button>
  )
}
