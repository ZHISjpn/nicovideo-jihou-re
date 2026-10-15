# 時報 Lite

ニコニコ動画の視聴ページで、かつて存在した「定時の時報」と、プレーヤー上部の「マーキーエリア」を、**自分のブラウザ上だけで簡易的に再現する** Firefox 拡張機能です。

> ⚠️ **非公式のプロジェクトです。** ニコニコ動画および株式会社ドワンゴとは関係がありません。サーバー側には何も影響せず、自分のブラウザの表示だけを変えます。

## 機能

| 機能 | 内容 |
|---|---|
| 定時の時報 | 毎日 **0:00** と **2:00** に、再生中の動画を一時停止（＋暗転）して、プレーヤー直上に時報動画（544×56）を再生します。終わると再生を自動で再開します。一時停止中・停止中でも時報は出ますが、その場合は終了後も一時停止・停止のままにします。 |
| イベント時報 | 指定した日時に別の時報動画を再生します。時報はクリックで指定URLへ移動でき、直後にはメッセージを一度だけ表示します。複数のイベントを予約できます。 |
| ニュース／お知らせ | 時報以外の時間は、プレーヤー直上に「ニュース」「お知らせ」の見出しを表示します（静止表示・切替時のみスクロール、◀ ▶ ✕ ボタンつき）。 |
| 時報のON/OFF | アカウントページ（`https://account.nicovideo.jp/my/account`）に設定パネルが追加され、**0時・2時・イベント**を個別にON/OFFできます。 |
| ZenzaWatch対応（試験的） | ユーザースクリプト [ZenzaWatch](https://github.com/kphrx/ZenzaWatch) のプレーヤー上でも時報を表示できます。**既定はOFF**で、アカウント設定の「ZenzaWatch上でも時報を表示（試験的）」をONにすると有効になります。 |

## 動作環境

- Firefox 115 以上（Firefox Developer Edition で動作確認）
- 視聴ページ（`https://www.nicovideo.jp/watch/…`）で動作します

## インストール

### 試す（一時的な読み込み）

1. `about:debugging#/runtime/this-firefox` を開く
2. 「一時的なアドオンを読み込む…」で、このリポジトリの `manifest.json` を選ぶ

Firefox を閉じると消えます。コードや設定を変えたあとは「再読み込み」で反映できます。

### 常用する（`.xpi`）

署名のないアドオンを入れるには、Firefox Developer Edition などで `about:config` の `xpinstall.signatures.required` を `false` にする必要があります。

1. 次のファイル・フォルダを **zip の最上階層に** まとめる（フォルダごと圧縮しない）
   `manifest.json` / `background.js` / `content.js` / `account.js` / `schedule.js` / `icons/` / `media/`
2. 拡張子を `.xpi` に変更する
3. `about:addons` → 歯車 → 「ファイルからアドオンをインストール…」で選ぶ
4. 入れ替えたあとは、Firefox を一度再起動する

## 使い方

### 時報動画を用意する

`media/jihou0.mp4`（0時）と `media/jihou2.mp4`（2時）には、動作確認用の**仮の動画**が入っています。自分で用意した動画（544×56 推奨、H.264 の mp4 など）で同じ名前で差し替えてください。

> 📌 **動画の権利にご注意ください。** かつての時報動画など、権利者のいる動画を、このリポジトリにコミット・公開しないでください。`media/events/` は、`.gitignore` で既定では除外しています。

### 時報の時刻・イベントを設定する

[`schedule.js`](schedule.js) を編集します。

```js
// 定時の時報（毎日）
globalThis.JIHOU_SCHEDULE = [
  { id: "0000", hour: 0, minute: 0, file: "media/jihou0.mp4" },
  { id: "0200", hour: 2, minute: 0, file: "media/jihou2.mp4" },
];

// イベント時報（複数予約できます。定時と同じ分に重なったらイベントが優先）
globalThis.JIHOU_EVENTS = [
  {
    id: "example-event",
    at: "2026-12-25 19:00",          // 開始日時（パソコンのタイムゾーン）
    file: "media/events/example.mp4", // 時報動画
    url: "https://example.com/",      // 時報をクリックしたときのURL
    message: "【お知らせ】メッセージ",  // 時報の直後に、一度だけ表示する文（省略可）
  },
];
```

### 時報のON/OFF

アカウント設定ページの「ブラウザのプッシュ通知設定」の上に、「時報の表示設定」パネルが追加されます。スイッチは保存されるとすぐに視聴ページへ反映されます（再読み込み不要）。

### 動作テスト

視聴ページの開発者ツール（F12）のコンソールで実行します。

```js
document.dispatchEvent(new Event("jihou:0"))      // 0時の時報
document.dispatchEvent(new Event("jihou:2"))      // 2時の時報
document.dispatchEvent(new Event("jihou:event"))  // schedule.js の1番目のイベント
```

詳しい使い方・設定項目・トラブルシューティングは、[docs/MANUAL.md](docs/MANUAL.md) を参照してください。

## ファイル構成

```
.
├─ manifest.json   拡張機能の定義（Manifest V2）
├─ background.js   ニュース／お知らせのフィード取得
├─ content.js      視聴ページでの表示・動作の本体
├─ account.js      アカウントページの設定パネル（時報のON/OFF）
├─ schedule.js     時報スケジュール・イベントの設定
├─ icons/          拡張機能のアイコン
├─ media/          時報動画（仮の動画が入っています）
└─ docs/MANUAL.md  マニュアル
```

## 権限とプライバシー

- 通信先は、ニュースとお知らせのフィード（`news.nicovideo.jp` / `blog.nicovideo.jp`）の**読み取りのみ**です。
- ログイン情報、視聴履歴、コメント、アカウント情報などは、読み取ったり送信したりしません。
- 設定（時報のON/OFF、スキップした項目）は、ブラウザ内（`storage.local`）にだけ保存されます。

## 既知の制約

- 簡易的な再現であり、かつての表示とは細部が異なります。
- サイトの画面構成が更新されると、位置合わせなどが崩れる可能性があります。
- ニュースの切替秒数など、一部の値は推測で決めています。

## 制作について

このプロジェクトのコードとドキュメントは、Anthropic の AI アシスタント **Claude AI**（Claude）を用いて制作されました。動作確認と仕様の決定は、作者が行っています。

## ライセンス

現時点では定めていません。
