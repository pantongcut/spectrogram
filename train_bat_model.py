import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import joblib

# ==========================================
# 1. 讀取數據
# ==========================================
print("正在讀取 Testing_AI_Data.csv...")
df = pd.read_csv("Testing_AI_Data.csv")

# ⚠️ 處理空值 (NaN)
# 因為 'Heel Freq' 有些是空的，我們用 -1 來填補，代表"無數據"
df = df.fillna(-1)

# ==========================================
# 2. 設定 X (題目) 和 y (答案)
# ==========================================
y = df['Species']            # 答案是 Species 那一欄
X = df.drop('Species', axis=1) # 題目是除了 Species 以外的所有欄位

# 取得特徵的數量 (你現在有 16 個參數)
n_features = X.shape[1]
print(f"偵測到 {n_features} 個特徵參數。")
print("特徵列表:", list(X.columns))

# ==========================================
# 3. 訓練模型
# ==========================================
print("正在訓練 Random Forest 模型...")
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

rf_model = RandomForestClassifier(n_estimators=100, random_state=42)
rf_model.fit(X_train, y_train)

y_pred = rf_model.predict(X_test)
print(f"訓練完成！準確率: {accuracy_score(y_test, y_pred)*100:.2f}%")

# ==========================================
# 4. 轉換為 ONNX (Web 用)
# ==========================================
print("正在轉換為 ONNX...")

# 注意：這裡會自動使用偵測到的特徵數量 (16)，不用手動改 10
initial_type = [('float_input', FloatTensorType([None, n_features]))]

# zipmap=False 讓輸出變成純數字陣列，方便 JS 讀取
onnx_model = convert_sklearn(rf_model, initial_types=initial_type, options={'zipmap': False})

output_filename = "bat_model.onnx"
with open(output_filename, "wb") as f:
    f.write(onnx_model.SerializeToString())

print(f"成功！已儲存 {output_filename}")