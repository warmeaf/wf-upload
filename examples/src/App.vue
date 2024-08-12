<script setup lang="ts">
import { ref } from "vue";
import { UploadController } from "@wf-upload/core";

const file = ref<null | File>(null);
const handleFileChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  // 获取到 File 对象
  if (target.files && target.files.length > 0) {
    file.value = target.files[0];
    console.log(file.value);
    handleUpload(file.value);
  }
};

const handleUpload = (file: File) => {
  const uc = new UploadController(file);
  uc.start()
};
</script>

<template>
  <div>
    <input type="file" @change="handleFileChange" />
  </div>
</template>
