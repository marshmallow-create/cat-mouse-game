# 段階5：GitHub・Render・Supabaseで共有する

今回は、PCで起動していたNode.jsサーバーをRenderへ置き、他のPCやスマホでも同じHTTPSのURLから遊べるようにします。利用者とスコアの保存先は、移行済みのSupabaseです。

## 現在の到達点

- Render公開用の `render.yaml`、HTTPS用Cookie、固定の公開URL確認、稼働確認、ログを準備しました。
- スマホ用の方向ボタン、指を離したときの停止、狭い画面での終了カード表示を追加しました。
- DBのバックアップと、通常のゲームDBへ書き込まず新しいローカル検証DBへ復元する機能を追加しました。
- 実際の公開URLと、別の端末からのアクセス確認はRenderへの接続・公開後に記録します。公開前は段階5を完了にはしません。

## 3つのサービスの役割

| サービス | 保存・実行するもの |
|---|---|
| GitHub | ゲームのコード・画像・公開設定 |
| Render | Node.jsサーバー。画面を配信し、登録・ログイン・スコア保存を処理 |
| Supabase | 利用者・ログイン状態・プレイ結果のPostgreSQL |

ブラウザ → HTTPSのRender → 証明書を確認したSSL接続 → Supabase、という流れです。利用者はGitHubやRenderのアカウントを作らず、ゲームの利用者名とパスワードで遊べます。

GitHub PagesはHTML・CSS・ブラウザ用JavaScriptを配信するサービスで、今回のNode.jsサーバーは実行できません。[GitHub公式](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## Renderで公開する設定

Renderアカウントを接続し、GitHubの `marshmallow-create/cat-mouse-game` を使用します。公開用ブランチは `stage5/render-deployment-20261011` です。`render.yaml` に次を登録しています。

| 項目 | 設定 |
|---|---|
| 種類 | Web Service（Node） |
| プラン | Free |
| リージョン | Singapore |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| 自動デプロイ | off（確認後に手動で公開） |

`render.yaml` は設定をまとめたBlueprintです。RenderのNew → Blueprintでリポジトリと公開用ブランチを指定するか、New → Web Serviceで上記を入力します。Node.jsは22系を指定します。[RenderのGit連携](https://render.com/docs/git-provider)、[Blueprint仕様](https://render.com/docs/blueprint-spec)

### 環境変数

**環境変数**は、コードを書き換えずにサーバーへ設定値を渡す仕組みです。RenderのEnvironmentで設定します。`.env` と `.local/` はGitHubへ送信しません。

| 名前 | 値・役割 |
|---|---|
| `NODE_ENV` | `production`。公開用の動作を有効にする |
| `HOST` | `0.0.0.0`。Renderの入口から接続を受ける |
| `DATABASE_MODE` | `supabase` |
| `DATABASE_URL` | ゲーム専用ロール `latte_app` の接続URL。管理者やservice_roleの情報は使わない |
| `DATABASE_SSL_CA` | CA証明書のPEM内容。ローカルのCAファイルはクラウドへ自動コピーされない |
| `APP_ORIGIN` | パスを含まないHTTPS公開URL。未指定ならRenderの `RENDER_EXTERNAL_URL` を使う |
| `PORT` | Renderが渡すポート番号を使う |

Renderのネットワークで直接接続が使えない場合は、SupabaseのConnect → Session poolerの接続先を使います。専用ロールの利用者名は `latte_app.PROJECT_REF`、ポートは5432です。ホストはConnect画面に表示された値を使い、推測で設定しません。パスワードの記号はURL用にエンコードします。SSLの証明書確認は無効にしません。[Supabaseの接続方法](https://supabase.com/docs/guides/database/connecting-to-postgres)

## 公開後に試すこと

1. Renderが表示したHTTPSのURLを開きます。`/healthz` が `ok` を返すことも確認します。
2. PCで利用者A、別のPCまたはスマホで利用者Bを登録・ログインします。
3. それぞれで1回遊び、自分のランキングだけが表示されることを確認します。
4. Renderのサーバーを再デプロイし、同じ利用者でログインして記録が残ることを確認します。
5. スマホでは方向ボタンを押し続けて移動します。指を離すと停止します。
6. ログアウトボタンはページ最下部の利用者名の右側にあります。

公開URLのlocalStorageはlocalhostのものとは別です。localhostに残っている未送信の記録は、その画面で保存してから公開URLへ移ります。保存済みの結果と利用者はSupabaseにあるので、同じアカウントでログインできます。

## HTTPS・稼働確認・ログ

**HTTPS**はブラウザとサーバーの通信を暗号化します。TLS証明書と外部のHTTPS入口はRenderが担当し、Node.jsはRender内部のHTTPで動きます。公開用CookieにはSecure・HttpOnly・SameSite=Strictを付けます。HTTPSの公開URLからのPOSTとCSRFトークンを確認し、転送されたHost値で許可するサイトを変更しません。

`/healthz` はDBへの `SELECT 1` が成功すると200、失敗すると503を返します。接続パスワードなどは返しません。

RenderのLogsでは、時刻・リクエスト番号・方法・パス・HTTP結果・処理時間をJSONで確認できます。パスワード・Cookie・本文・URLのクエリ文字列は記録しません。例えば503が増えたら、Supabaseの稼働状態・接続先・CA証明書を確認します。ログを見れば、どの処理で失敗したかを利用者の秘密情報なしで調べられます。

認証試行制限は公開環境では利用者名ごと、15分に30回までです。プロキシの同じIPを共有する複数人を一括で制限しないためです。今回の無料プランは1インスタンスで使い、複数台へ増やす場合は試行制限の状態も共有DBなどへ移します。

## バックアップと復元を試す

**バックアップ**は利用者と記録の控えを別の場所へ保存することです。無料のSupabaseでは定期的な外部保存を推奨しています。[Supabaseのバックアップ](https://supabase.com/docs/guides/platform/backups)

このPCのPowerShellで次を実行すると、`.env` の接続先から読み取り、`.local/backups/` に日時付きJSONを保存します。既存の控えを上書きしません。

```powershell
npm.cmd run db:backup
```

このJSONは利用者名とパスワードハッシュを含むので、GitHubへは置かず、自分が管理する別の保存先にも控えを保管します。セッションはバックアップせず、復元後は再ログインします。この機能はゲームのデータ専用で、Supabase全体の設定・Storageなどは対象にしません。表の定義は `database/` にあるSQLで管理します。

**復元**は控えから元の情報を戻すことです。確認には新しいローカルDBだけを使用します。通常の `latte_game` やSupabaseへは書き込みません。

```powershell
node scripts/database.js start
node scripts/restore-game-data.js .local/backups/実際のファイル名.json latte_restore_check_01
```

復元先の名前は `latte_restore_` で始まり、未使用の名前に限ります。同じ名前で再実行すると既存DBを上書きせず失敗します。控えの形式・件数・外部キーを確認して復元し、自動採番も引き継ぎます。失敗した検証DBも通常のゲームDBには影響しません。

バックアップ作成は手動です。学習中は変更前・プレイ記録が増えたあとに実行してください。定期実行・保存期間・本番への復元手順は、利用範囲が決まった後に設定します。

## 無料枠と確認範囲

Render Freeは15分アクセスがないと休止し、次のアクセスで起動まで約1分かかります。利用枠と外部DB通信の制限もあるため、まず小人数の学習用として使います。[Render Freeの仕様](https://render.com/docs/free)

ローカルで公開用設定のテスト、Supabaseバックアップ、新規ローカルDBへの復元、スマホ幅のEdgeでタッチ操作を確認済みです。HTTPS入口を含む実際の公開動作は、Render公開後に別途確認します。業務用では、運用プラン・認証の復旧・監視・定期バックアップを整えてから利用範囲を広げます。
