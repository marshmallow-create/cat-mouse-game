# 段階2：PostgreSQLとSQLを学ぶ

今回の目的は、プレイ結果を保存する表を作り、SQLで追加・読み出し・並べ替えをできるようにすることです。

## 今回の構成

| 名前 | 意味 | 今回の具体例 |
|---|---|---|
| PostgreSQL | 記録を保存し、要求に応じて取り出すソフトウェア | このPCで動くPostgreSQL 18.6 |
| データベース | 表をまとめて入れる場所 | `latte_game` |
| テーブル（表） | 同じ種類の記録を並べる場所 | `game_results` |
| 行 | 1件の記録 | 1回分のプレイ結果 |
| 列 | 記録の項目 | `id`、`score`、`played_at` |
| 主キー | 1行を確実に区別する番号など | 自動で付く `id` |
| SQL | データベースへ指示する言葉 | 「追加して」「スコア順で見せて」 |
| psql | SQLを入力するための道具 | ターミナルからPostgreSQLに接続する |

Node.jsのサーバーはポート3000、PostgreSQLはポート5433です。別々のソフトウェアなので、起動・停止も別々に行います。この段階ではpsqlからSQLを送り、段階3でNode.jsのサーバーからSQLを送れるようにします。

## 追加したファイルと保存場所

| ファイル・場所 | 役割 |
|---|---|
| `database/schema.sql` | 表の構造と入力のルールを作る |
| `database/practice.sql` | 練習用の記録を追加してランキングを取り出す |
| `scripts/database.js` | PostgreSQLの準備・起動・停止・psql接続を補助する |
| `.local/postgres/runtime/` | このプロジェクト専用のPostgreSQL本体 |
| `.local/postgres/data/` | 実際に保存されたデータ |
| `.local/postgres/pgpass.conf` | このPC専用の接続パスワード |
| `.local/postgres/postgres.log` | PostgreSQLの動作ログ |
| `.local/postgres/launcher.log` | 起動用コマンドのログ |

`.local/` は `.gitignore` でGitの対象外にしています。データや接続パスワードをコードと一緒に共有しないためです。パスワードは準備時にランダム生成し、接続スクリプトが読み込みます。値をチャットへ貼る必要はありません。

Windowsのサービスへの登録は行わず、`127.0.0.1:5433` でこのPC内だけから接続します。管理者用の利用者名は `latte_admin` です。ゲームから接続するための権限は、段階3で別途整理します。

## 起動して練習する

PowerShellで、まずプロジェクトのフォルダーへ移動します。

```powershell
cd C:\marshmallow\codex_projects\cat-mouse-game
node scripts/database.js start
node scripts/database.js practice
```

`practice` はSQLファイルを実行し、4件の練習記録を追加して、スコアの高い順に表示します。空の表で実行した場合、スコアは **18 → 18 → 12 → 7** の順です。同じ18点なら、10:20の記録が10:10の記録より上になります。

最後に `ROLLBACK` で今回の追加を取り消すため、繰り返し実行しても練習記録は蓄積されません。もともとの記録は残ります。表示された番号は次回変わります。

## 自分でSQLを入力する

次のコマンドでpsqlを開きます。

```powershell
node scripts/database.js shell
```

`latte_game=#` と表示されたら、PostgreSQLへSQLを送れる状態です。ここで入力するのはSQLで、PowerShellのコマンドとは違います。

まず表の構造を見ます。

```text
\d game_results
```

次に、12点の記録を1件保存します。

```sql
INSERT INTO game_results (score)
VALUES (12)
RETURNING id, score, played_at;
```

`INSERT INTO` は追加先の表、`VALUES` は入れる値、`RETURNING` は追加した行を表示する指定です。今回は `id` と `played_at` を省略したので、番号と現在日時が自動で設定されます。psqlは通常、自動確定するため、この記録は保存されます。

今度は高いスコア順に読み出します。

```sql
SELECT id, score, played_at
FROM game_results
ORDER BY score DESC, played_at DESC, id DESC
LIMIT 10;
```

- `SELECT`：表示する列。
- `FROM`：読み出す表。
- `ORDER BY`：並べ替えの条件。`DESC` は大きい値・新しい日時を先にする指定。
- `LIMIT 10`：最大10件まで取り出す指定。

SQLは最後の `;` まで入力すると実行されます。入力途中で `latte_game-#` と表示されるのは、続きの入力を待っている状態です。終了するときは `\q` と入力します。

## 保存されたことを自分で確かめる

1. 上の `INSERT` で記録を追加し、表示された番号を確認します。
2. `\q` でpsqlを閉じます。
3. PostgreSQLを停止・再起動します。

   ```powershell
   node scripts/database.js stop
   node scripts/database.js start
   node scripts/database.js shell
   ```

4. もう一度上の `SELECT` を実行します。同じ番号の記録が残っていれば、データが保存されています。

画面で一時的に持つスコアと違い、データベースの記録はPostgreSQLを止めても消えません。`.local/postgres/data/` がその保存場所なので、このフォルダーは削除しないでください。

## 表に設定したルール

`database/schema.sql` は次の構造を作ります。

| 列 | 種類 | ルール |
|---|---|---|
| `id` | 大きな整数 | 自動採番する主キー。同じ番号は使えない |
| `score` | 整数 | 必須。0以上 |
| `played_at` | 時刻を正しく扱える日時 | 必須。省略時は現在日時 |

`NOT NULL` は「未入力を許さない」、`CHECK` は「値が条件に合うか確認する」というルールです。画面やサーバーの確認に加え、データベースでも不正な記録を防ぎます。次をpsqlで試すと、負のスコアはエラーになります。

```sql
INSERT INTO game_results (score) VALUES (-1);
```

このエラーはルールが働いた結果です。記録は追加されません。0点は有効な結果なので保存できます。

`TIMESTAMPTZ` は日時の瞬間を扱い、表示する時間帯に応じて表現します。この接続では日本時間（Asia/Tokyo）で表示します。

主キーの番号は、失敗した追加や取り消した練習でも先へ進むことがあります。番号に抜けがあっても正常です。主キーは順位や件数とは別の役割です。

## コマンド一覧

| 操作 | コマンド |
|---|---|
| 初回のダウンロード・初期化・表作成 | `node scripts/database.js setup` |
| 起動 | `node scripts/database.js start` |
| 停止 | `node scripts/database.js stop` |
| 状態の確認 | `node scripts/database.js status` |
| SQLを自分で入力 | `node scripts/database.js shell` |
| 練習SQLの実行 | `node scripts/database.js practice` |

`setup` は既存の表や記録を消しません。別のPCで初めて実行すると、EDBからWindows x64用PostgreSQL 18.6のZIP（約385MB）をダウンロードします。Windows標準の `tar.exe` で展開します。

`package.json` にショートカットも登録しています。例えば `npm.cmd run db:start`、`npm.cmd run db:practice` でも同じ処理を実行できます。

接続できない場合は `status` を確認し、停止中なら `start` を実行します。起動時にエラーになる場合は `.local/postgres/postgres.log` を確認します。接続先は5433なので、ゲーム用サーバーの3000とは区別してください。

## 会社用システムへのつながり

今回の「1行＝1回のプレイ」は、業務では「1行＝1件の作業報告」などになります。主キーで記録を区別し、必須項目や値のルールをデータベースにも持たせる考え方は共通です。

次の段階3では、ゲーム終了 → Node.jsのAPI → PostgreSQLへの保存 → ランキング表示をつなげます。この段階2で保存するのは、SQLで追加した記録です。

## 実装時の確認結果（2026-10-08）

- 実際のPostgreSQL 18.6で、表作成とSQLの追加・読み出し・並べ替えを確認。
- 同点の新しい日時が先になること、0点の保存と省略した日時の自動設定を確認。
- 負のスコア、未入力のスコア・日時、主キーの重複を拒否することを確認。
- 練習SQLを2回実行しても既存の記録が増減しないことを確認。
- 記録を保存し、PostgreSQLを停止・再起動して同じ記録を読み出せることを確認。
- `setup` を再実行しても保存済みの記録が残ることを確認。
- テストで追加した記録だけを削除し、ゲーム用の表は空の状態。検証後のPostgreSQLは停止しています。

Windowsでの起動処理は、バックグラウンドのPostgreSQLがターミナルの出力を保持しないよう、起動用ログをファイルへ出す構成にしています。

参考：[PostgreSQLのSQL入門](https://www.postgresql.org/docs/18/tutorial-sql.html)、[制約の説明](https://www.postgresql.org/docs/18/ddl-constraints.html)、[Windows向けダウンロード案内](https://www.postgresql.org/download/windows/)。
