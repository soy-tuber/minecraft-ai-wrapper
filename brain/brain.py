import json
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# vLLM Configuration
VLLM_URL = "http://localhost:8000/v1/chat/completions"
MODEL_NAME = "nvidia/NVIDIA-Nemotron-Nano-9B-v2-Japanese"

# プレイヤーごとの会話履歴を保存する辞書（メモリ節約のため最新10件に制限）
chat_history = {}
MAX_HISTORY = 5

SYSTEM_PROMPT = """
あなたはマインクラフトのAIエージェント「Nemobot」です。フレンドリーで楽しい性格です。
必ず以下の形式で回答してください。余計な説明は一切不要です。
[思考] 1文だけ
[実行] コマンド1つだけ

行動指示でない普通の会話（雑談、質問、感想など）にはCHATで楽しく返事してください。
マイクラの豆知識を教えたり、冗談を言ったり、一緒に冒険を楽しむ仲間として振る舞ってください。
返事は短く（1-2文）。日本語でも英語でも、相手の言語に合わせて返してください。

[実行]に使用できるコマンド:
1. CHAT("メッセージ") - チャットで返事
2. FOLLOW() - プレイヤーについていく
3. STOP() - すべて停止
4. ATTACK("mob名") - 1匹攻撃（例: "sheep", "zombie", "cow", "pig", "chicken"）
5. HUNT("mob名") - 周りの同種Mobを全部狩る
6. DIG_TREE() - 近くの木を1本切る
7. DIG_DOWN("数字") - 指定ブロック数だけ階段を掘る（例: "5"）
8. GUARD() - ボディガードモード（ついてきながら敵を自動攻撃）
9. DANCE() - ダンスする
10. LOOK_AROUND() - 周囲のMobやプレイヤーを報告
11. GO_TO("x y z") - 指定座標に移動（例: "100 64 200"）
12. DROP_ITEMS() - 持ち物を全部落とす
13. COLLECT() - 近くに落ちているアイテムを拾い集める
14. GIVE() - プレイヤーのところに行ってアイテムを渡す

例:
ユーザー: "come here"
[思考] 移動指示。
[実行] FOLLOW()

ユーザー: "kill the sheep"
[思考] 羊を1匹倒す。
[実行] ATTACK("sheep")

ユーザー: "kill all the sheep" / "hunt sheep"
[思考] 周りの羊を全部狩る。
[実行] HUNT("sheep")

ユーザー: "cut a tree" / "chop wood"
[思考] 木を切る。
[実行] DIG_TREE()

ユーザー: "dig down 10 blocks"
[思考] 10ブロック掘る。
[実行] DIG_DOWN("10")

ユーザー: "protect me" / "guard me"
[思考] ガードモード開始。
[実行] GUARD()

ユーザー: "dance!"
[思考] ダンスする。
[実行] DANCE()

ユーザー: "what do you see?" / "look around"
[思考] 周囲を確認。
[実行] LOOK_AROUND()

ユーザー: "go to 100 64 200"
[思考] 座標に移動。
[実行] GO_TO("100 64 200")

ユーザー: "drop your items"
[思考] アイテムを落とす。
[実行] DROP_ITEMS()

ユーザー: "pick up items" / "collect"
[思考] 落ちているアイテムを拾う。
[実行] COLLECT()

ユーザー: "give me your stuff" / "bring items"
[思考] プレイヤーにアイテムを届ける。
[実行] GIVE()

ユーザー: "hello" / "hi"
[思考] 挨拶。
[実行] CHAT("こんにちは！何かお手伝いしましょうか？")

ユーザー: "stop"
[思考] 停止。
[実行] STOP()
"""

def strip_thinking(text):
    """Nemotronの思考部分を除去する（<think>タグあり・なし両対応）"""
    import re
    # </think>がある場合、それ以前を全て除去
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    # <think>...</think>の完全ペアも除去
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    return text.strip()

def extract_action(text):
    import re
    text = strip_thinking(text)
    match = re.search(r"\[実行\]\s*([A-Z_]+)\((.*?)\)", text)
    if match:
        return match.group(1), match.group(2).strip('"')
    # [実行]がなくてもコマンドパターンを拾う
    cmd_match = re.search(r'(CHAT|FOLLOW|STOP|ATTACK|HUNT|DIG_TREE|DIG_DOWN|GUARD|DANCE|LOOK_AROUND|GO_TO|DROP_ITEMS|COLLECT|GIVE)\("?(.*?)"?\)', text)
    if cmd_match:
        return cmd_match.group(1), cmd_match.group(2)
    return "CHAT", "うーん、よく分からなかった..."

@app.route("/", methods=["GET"])
def index():
    return "Nemobot Brain is running! (Use POST /ask for interaction)"

@app.route("/favicon.ico")
def favicon():
    return "", 204

@app.route("/ask", methods=["POST"])
def ask():
    data = request.json
    player_name = data.get("player", "Player")
    message = data.get("message", "")

    print(f"[{player_name}] {message}")

    if player_name not in chat_history:
        chat_history[player_name] = []

    chat_history[player_name].append({"role": "user", "content": f"{player_name}: {message}"})

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(chat_history[player_name])

    try:
        response = requests.post(
            VLLM_URL,
            json={
                "model": MODEL_NAME,
                "messages": messages,
                "temperature": 0.3,
                "max_tokens": 1024  # 思考+構造出力に十分なトークン数
            },
            timeout=30
        )
        
        result = response.json()
        raw_content = result["choices"][0]["message"]["content"]
        
        # 思考部分をログに表示
        print(f"Raw Output: {raw_content}")
        
        action_type, action_value = extract_action(raw_content)

        # STOPで履歴リセット（混乱状態を解消）
        if action_type == "STOP":
            chat_history[player_name] = []
            return jsonify({"action": "STOP", "value": "", "raw": raw_content})

        # 履歴にはテキストのみ保存（または整形して保存）
        chat_history[player_name].append({"role": "assistant", "content": raw_content})

        if len(chat_history[player_name]) > MAX_HISTORY * 2:
            chat_history[player_name] = chat_history[player_name][-(MAX_HISTORY * 2):]

        return jsonify({
            "action": action_type,
            "value": action_value,
            "raw": raw_content
        })

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"action": "CHAT", "value": "ちょっと混乱しちゃった...", "error": str(e)}), 500

if __name__ == "__main__":
    # Flaskサーバーを起動（ボットからのリクエスト待機用）
    app.run(host="0.0.0.0", port=5005)
