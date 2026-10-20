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

!macro customUnInstall
  ; 更新のための一時的なアンインストールでは消さない
  ${IfNot} ${isUpdated}
    SetShellVarContext current
    Delete "${EVERPAD_SENDTO_DIR}\${PRODUCT_NAME}.lnk"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend
