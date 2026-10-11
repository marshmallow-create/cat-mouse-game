# Supabaseへデータベースを移す

今回はデータベースをクラウドへ移します。利用者名＋パスワードのログイン、猫の選択、スコア保存は今のNode.jsサーバーを使います。ゲーム自体のインターネット公開とスマホ操作は後の段階です。

## 現在の状態

- 東京リージョンの `cat-mouse-game`（`woguzxkvzuwnzfktaicy`）へ移行済みです。
- 1利用者・7プレイ記録を取り込み、番号・日時・パスワードハッシュを含む全項目が元データと一致することを確認しました。
- `.env` の接続先をSupabaseへ変更しました。`npm start` で起動し、既存の利用者名とパスワードで再ログインしてください。起動中のサーバーがある場合はCtrl+Cで止めて再起動します。
- 従来の `node scripts/server.js` でも、サーバーがプロジェクトの `.env` を読み込みます。起動時に「データベース: Supabase」と表示されることを確認してください。起動前から明示した環境変数は優先します。
- PCからの直接接続とSSL証明書の検証が成功したため、今回はSession poolerを使用していません。
- `database/supabase-schema.sql` の3つの表・RLS・専用ロールを適用済みです。セキュリティ検査の指摘はありません。
- 移行時の控えは `.local/supabase/game-data-migration.json`。移行直後のローカル再確認も1利用者・7記録でした。ローカルDBを削除せず保持しています。

## ブラウザで中身を見る

1. [cat-mouse-gameのTable Editor](https://supabase.com/dashboard/project/woguzxkvzuwnzfktaicy/editor) を開きます。
2. `public` スキーマの `game_users` を選ぶと、利用者を確認できます。
3. `game_results` を選ぶと、スコア・遊んだ日時・利用者番号を確認できます。
4. ゲームでログインして1回遊び、保存後にTable Editorを更新すると新しい行が増えます。

`password_hash` はパスワードの原文ではなく、照合用の値です。`game_sessions` はログイン中の情報で、移行直後は空です。既存の自作認証を使うため、Authenticationの利用者一覧には表示されません。

## データの流れ

ブラウザ → ローカルのNode.jsサーバー → SupabaseのPostgreSQL

Supabase DashboardのTable Editorでは、管理者として表の中身をブラウザで確認できます。ゲームの利用者アカウントは `game_users` の行として管理します。今回はSupabase Authを使わないため、Authenticationの利用者一覧には表示されません。

## 移行する内容

- `game_users`：利用者番号・利用者名・パスワードのハッシュ・登録日時。
- `game_results`：記録番号・利用者番号・スコア・日時・重複防止のプレイ番号。古い所有者不明の記録も保持します。
- 採番の続き：次に登録する利用者やプレイが、以前の番号と重複しないようにします。
- `game_sessions` は空で始め、移行後に再ログインします。

移行用の控えにパスワードのハッシュが含まれるため、Gitへ追加せず、HTML配信も行いません。

## 接続設定

`.env.example` を参考に `.env` を用意します。`npm start` はこのファイルをサーバー側で読み込みます。環境変数とは、接続先などをコードに直接書かず指定する設定です。

現在は `DATABASE_MODE=supabase`、ゲーム専用ロール `latte_app` の直接接続URL、`DATABASE_SSL_CA_FILE=.local/supabase/supabase-ca.crt` を設定済みです。CA証明書はSupabase管理画面の公式ソースに記載された配布先から取得しました。証明書・ホスト名の検証は有効です。将来IPv4のみの公開先へ移す場合は、DashboardのConnectからSession poolerのホストを取得し、その接続URLへ変更します。

`DATABASE_MODE=local` にするとローカルのDBを使えます。ただし切替後のクラウドの新しい記録は、ローカルに自動同期されません。

## 権限と確認

`latte_app` はNode.js専用のDBロールです。利用者名でログインするゲーム利用者とは別です。記録の読み書きに必要な権限だけを与え、ブラウザ向けData APIの `anon`・`authenticated` には今回の表を公開しません。RLS（表の行へのアクセス制限）を有効にし、サーバーロールだけを許可します。誰の記録を扱うかは、既存のNode.js認証・APIで確認します。

確認済み：全データの一致、採番の続き、SSL接続、専用ロールによる利用者・セッション・結果の読み書き、匿名APIからの表アクセス禁止、検証利用者による登録・ログイン・ログアウト・スコア保存・ランキング・二重保存防止。検証利用者と結果は削除し、1利用者・7記録を保持しています。

既存利用者のパスワード原文は取得していないため、実際の既存パスワードでのログインはご自身で確認してください。ハッシュは同じ値を移し、照合処理も維持しています。ゲームのインターネット公開・スマホ操作はまだ未実施です。

接続・権限だけの再確認：`node --env-file=.env scripts/check-cloud-database.js`。検証行は取り消します。登録からのAPI検証は明示的な実行だけにし、`tests/supabase-api.test.js` の検証アカウントを管理者で削除する必要があります。

会社用システムでも、アプリ用アカウントとDB管理者を分け、保存後に管理画面で実データを確認する流れを使います。

公式資料：[Postgresからの移行](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres)、[DB接続](https://supabase.com/docs/guides/database/connecting-to-postgres)
