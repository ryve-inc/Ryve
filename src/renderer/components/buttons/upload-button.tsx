import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function UploadButton() {
  const { uploadFiles, showToast } = useDrive()

  return (
    <Button asChild>
      <label className="cursor-pointer">
        Upload
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            uploadFiles(e.target.files || []).catch((err) => showToast(err.message))
            e.target.value = ''
          }}
        />
      </label>
    </Button>
  )
}
