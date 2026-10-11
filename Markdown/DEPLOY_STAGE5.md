# 段階5：GitHub・Render・Supabaseで共有する

今回は、PCで起動していたNode.jsサーバーをRenderへ置き、他のPCやスマホでも同じHTTPSのURLから遊べるようにします。利用者とスコアの保存先は、移行済みのSupabaseです。

## 現在の到達点

- Render公開用の `render.yaml`、HTTPS用Cookie、固定の公開URL確認、稼働確認、ログを準備しました。
- スマホ用の方向ボタン、指を離したときの停止、狭い画面での終了カード表示を追加しました。
- DBのバックアップと、通常のゲームDBへ書き込まず新しいローカル検証DBへ復元する機能を追加しました。
- 公開URLは https://cat-mouse-game.onrender.com です。HTTPSの画面配信・登録・ログイン・記録保存が利用できます。
- [Renderの管理画面](https://dashboard.render.com/web/srv-db5n8pjbc2fs739fjaog)で状況を確認できます。Free・Singapore、公開用ブランチ、自動デプロイoffで作成しました。
- RenderのDB接続は、利用者がConnect画面で確認した `aws-0-ap-northeast-1.pooler.supabase.com:5432` のSession poolerへ切り替えました。直接接続の `ENETUNREACH` は解消し、TLSの証明書確認とゲーム専用ロールを維持しています。ローカルの接続設定は保持しています。
- 公開APIで2人分の登録・ログイン・ログアウト・保存・二重保存防止・ランキング分離を確認しました。Edgeの公開画面で、スマホ幅のタッチ移動・停止、30秒のプレイ・自動保存・再読み込み後の記録保持も確認済みです。
- Renderの再デプロイ後もログインと保存済み記録を確認しました。検証用アカウントと記録は削除し、既存の1利用者・3記録を保持しています。
- 利用者が実際のスマホから記録を保存できたと確認しました。別端末から共有DBへ保存する到達点と、RenderのHTTP稼働確認設定は確認済みです。段階5の基本機能は完了しました。スマホUI・UXの課題は別途整理・改善します。

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

実サービスのHealth Check Pathは `/healthz` に設定済みです。これは「画面が返る」だけでなく「記録の保存先へ接続できる」ことをRenderが確認するための設定です。

### 稼働確認を設定する

2026-10-11に利用者が管理画面で保存し、接続ツールで `/healthz` の反映と最新デプロイの `live` を確認しました。公開URLも200・`ok` を返しました。変更前の空欄では既定のTCP確認が使われ、サーバーの接続受付だけを確認していました。`/healthz` ではサーバーがSupabaseへ簡単なSQLを実行し、保存先にも接続できることを確認します。[Render公式の稼働確認](https://render.com/docs/health-checks)

1. [cat-mouse-gameの設定画面](https://dashboard.render.com/web/srv-db5n8pjbc2fs739fjaog/settings)を開きます。
2. **Health Checks** の **Health Check Path** にある **Edit** を押します。
3. `/healthz` を入力して **Save Changes** を押します。公開URL全体ではなく、パスだけを入力します。
4. 保存後に設定値が `/healthz` であることと、[稼働確認URL](https://cat-mouse-game.onrender.com/healthz)が `ok` を返すことを確認します。

現在の接続ツールにはこの設定を変更する機能がないため、管理画面での操作が必要です。保存後の設定値とデプロイ状態は接続ツールで確認できます。RenderはHTTP稼働確認で5秒以内の2xx・3xxを成功と判断します。業務システムでも、画面を表示できるだけでなく、必要なDBへ接続できるかを運用上の判断に使います。

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

ローカルの公開設定テスト、Supabaseバックアップ、新規ローカルDBへの復元に加え、RenderのHTTPS入口を通したAPIとEdgeの実画面を確認済みです。利用者から実際のスマホによる保存成功の報告も受けています。運用設定とスマホUI・UXの改善を続けます。業務用では、運用プラン・認証の復旧・監視・定期バックアップを整えてから利用範囲を広げます。
