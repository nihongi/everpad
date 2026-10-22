; EverPad のインストーラーに足す処理(electron-builder の nsis.include で読み込む)。
; インストール先を選ぶ画面の次に、エクスプローラーの「送る」メニューに登録するかのチェックボックスを出す。
; 既定はオフ。すでに登録してあれば、チェックした状態で始める。
; 画面を出さないインストール(/S や自動更新)では、登録を変えない。
; 「送る」はユーザーごとの場所なので、全ユーザー向けのインストールでも、インストールしている人の場所に作る。

!define EVERPAD_SENDTO_DIR "$APPDATA\Microsoft\Windows\SendTo"

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var EverPadSendToBox
  Var EverPadSendToState

  LangString EverPadSendToCaption 1033 "Additional options"
  LangString EverPadSendToCaption 1041 "追加の設定"
  LangString EverPadSendToSub 1033 "Choose whether to add EverPad to the Explorer menu."
  LangString EverPadSendToSub 1041 "エクスプローラーのメニューに EverPad を追加するかを選びます。"
  LangString EverPadSendToText 1033 "Add EverPad to the $\"Send to$\" menu (text files sent to it become new notes)"
  LangString EverPadSendToText 1041 "「送る」メニューに EverPad を追加する(送ったテキストファイルが新しいメモになります)"
  LangString EverPadSendToNote 1033 "You can change this later in EverPad with File > Add to the $\"Send to$\" Menu."
  LangString EverPadSendToNote 1041 "あとから EverPad の「ファイル」→「「送る」メニューに登録」でも変更できます。"

  !macro customPageAfterChangeDir
    Page custom EverPadSendToCreate EverPadSendToLeave

    Function EverPadSendToCreate
      !insertmacro MUI_HEADER_TEXT "$(EverPadSendToCaption)" "$(EverPadSendToSub)"
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateCheckbox} 0 0 100% 24u "$(EverPadSendToText)"
      Pop $EverPadSendToBox
      SetShellVarContext current
      ${If} ${FileExists} "${EVERPAD_SENDTO_DIR}\${PRODUCT_NAME}.lnk"
        ${NSD_Check} $EverPadSendToBox
      ${EndIf}
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      ${NSD_CreateLabel} 0 34u 100% 24u "$(EverPadSendToNote)"
      Pop $0
      nsDialogs::Show
    FunctionEnd

    Function EverPadSendToLeave
      ${NSD_GetState} $EverPadSendToBox $EverPadSendToState
    FunctionEnd
  !macroend

  !macro customInstall
    ; 画面でチェックを付けたら作り、外したら消す(画面を通らなかったときは何もしない)
    SetShellVarContext current
    ${If} $EverPadSendToState == ${BST_CHECKED}
      CreateDirectory "${EVERPAD_SENDTO_DIR}"
      CreateShortCut "${EVERPAD_SENDTO_DIR}\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    ${ElseIf} $EverPadSendToState == ${BST_UNCHECKED}
      Delete "${EVERPAD_SENDTO_DIR}\${PRODUCT_NAME}.lnk"
    ${EndIf}
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  !macroend
!endif

; ---------- アンインストール ----------
; 最初の画面の次に「EverPad の設定も削除する」のチェックボックスを出す(既定はオフ)。メモの保存先は削除しない。
; 設定はユーザーごとの %APPDATA%\EverPad にあるので、削除できるのはアンインストールを実行しているユーザーの分だけ
; (すべてのユーザー向けのインストールでも同じ。他のユーザーの設定には触れない)。
; 更新のための一時的なアンインストールと、画面を出さないアンインストール(/S)では削除しない。
!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var EverPadDelBox
  Var EverPadDelState

  LangString EverPadDelCaption 1033 "Settings"
  LangString EverPadDelCaption 1041 "設定の削除"
  LangString EverPadDelSub 1033 "Choose whether to delete EverPad's settings as well."
  LangString EverPadDelSub 1041 "EverPad の設定も削除するかを選びます。"
  LangString EverPadDelText 1033 "Also delete EverPad's settings (your notes are not deleted)"
  LangString EverPadDelText 1041 "EverPad の設定も削除する(メモの保存先は削除しません)"
  LangString EverPadDelNote 1033 "Only the settings of the user running this uninstaller are deleted:$\r$\n$0$\r$\nThe settings of other users are not deleted. Your notes stay in their data folder (by default, Documents\EverPad)."
  LangString EverPadDelNote 1041 "削除するのは、このアンインストールを実行しているユーザーの設定だけです:$\r$\n$0$\r$\n他のユーザーの設定は削除しません。メモは保存先フォルダ(既定は ドキュメント\EverPad)に残ります。"

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.EverPadDelCreate un.EverPadDelLeave

    Function un.EverPadDelCreate
      ${If} ${isUpdated}
        Abort   ; 更新のときは出さない
      ${EndIf}
      !insertmacro MUI_HEADER_TEXT "$(EverPadDelCaption)" "$(EverPadDelSub)"
      nsDialogs::Create 1018
      Pop $1
      ${NSD_CreateCheckbox} 0 0 100% 24u "$(EverPadDelText)"
      Pop $EverPadDelBox
      SetShellVarContext current
      StrCpy $0 "$APPDATA\${PRODUCT_NAME}"
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
      ${NSD_CreateLabel} 0 34u 100% 60u "$(EverPadDelNote)"
      Pop $1
      nsDialogs::Show
    FunctionEnd

    Function un.EverPadDelLeave
      ${NSD_GetState} $EverPadDelBox $EverPadDelState
    FunctionEnd
  !macroend
!endif

!macro customUnInstall
  ; 更新のための一時的なアンインストールでは消さない
  ${IfNot} ${isUpdated}
    SetShellVarContext current
    Delete "${EVERPAD_SENDTO_DIR}\${PRODUCT_NAME}.lnk"
    ; 画面でチェックを付けたときだけ、このユーザーの設定(%APPDATA%\EverPad)を削除する
    ${If} $EverPadDelState == ${BST_CHECKED}
      RMDir /r "$APPDATA\${PRODUCT_NAME}"
    ${EndIf}
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend
