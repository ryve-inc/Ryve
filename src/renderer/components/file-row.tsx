type Props = {
  title: string
  meta: string
  onClick: () => void
}

export function FileRow({ title, meta, onClick }: Props) {
  return (
    <li>
      <button type='button' className='file-row w-full text-left' onClick={onClick}>
        <div>
          <div className='display-title text-[15px]'>{title}</div>
          <div className='mt-0.5 font-mono text-xs text-mute'>{meta}</div>
        </div>
      </button>
    </li>
  )
}
