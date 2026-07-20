import { Button } from '@/components/ui/button'
import { useDrive } from '@/context/drive-context'

export function UploadButton() {
  const { uploadPaths, showToast } = useDrive()

  return (
    <Button
      onClick={() => {
        uploadPaths().catch((err) => showToast(err.message))
      }}
    >
      Upload
    </Button>
  )
}
