; Uninstalling used to hang, and the reason is our own doing: closing the window only
; hides the app to the tray, so when the uninstaller politely asks it to close, it refuses
; and keeps running. A running process holds StreamGarden.exe open, Windows won't delete a
; locked file, and the uninstall stalls half-finished.
;
; So we stop asking and just end the process — along with any yt-dlp or ffmpeg it spawned,
; which hold the resources\bin folder open the same way. /T takes the children with it and
; /F doesn't wait for a reply that never comes. Errors are ignored on purpose: "not running"
; is the normal case, and it must not be treated as a failure.

!macro killStreamGarden
  nsExec::Exec 'taskkill /F /T /IM StreamGarden.exe'
  nsExec::Exec 'taskkill /F /IM yt-dlp.exe'
  nsExec::Exec 'taskkill /F /IM ffmpeg.exe'
  ; Give Windows a moment to release the file handles before we touch the folder.
  Sleep 700
!macroend

; Before installing over an existing copy.
!macro customInit
  !insertmacro killStreamGarden
!macroend

; Before uninstalling — this is the one that was broken.
!macro customUnInit
  !insertmacro killStreamGarden
!macroend

; Deliberately not overriding customRemoveFiles — electron-builder's own deletion is more
; careful about install modes than a blanket RMDir would be, and once the process is dead
; there is nothing left holding the files.
