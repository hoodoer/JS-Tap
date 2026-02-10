package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"os"
)

// Request is the inbound message format from the browser extension.
type Request struct {
	ID      string                 `json:"id"`
	Command string                 `json:"command"`
	Args    map[string]interface{} `json:"args"`
}

// Response is the outbound message format back to the extension.
type Response struct {
	ID      string      `json:"id"`
	Command string      `json:"command"`
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func main() {
	reader := bufio.NewReader(os.Stdin)

	for {
		// 1. Read the 4-byte length prefix
		lengthBytes := make([]byte, 4)
		_, err := io.ReadFull(reader, lengthBytes)
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Printf("Error reading length: %v", err)
			return
		}

		// 2. Decode length (Little Endian per native messaging spec)
		msgLen := binary.LittleEndian.Uint32(lengthBytes)

		// 3. Read exactly 'msgLen' bytes
		msgContent := make([]byte, msgLen)
		_, err = io.ReadFull(reader, msgContent)
		if err != nil {
			log.Printf("Error reading message content: %v", err)
			return
		}

		// 4. Parse the request
		var req Request
		if err := json.Unmarshal(msgContent, &req); err != nil {
			sendResponse(Response{
				ID:      "",
				Command: "",
				Success: false,
				Error:   "Invalid JSON: " + err.Error(),
			})
			continue
		}

		// 5. Dispatch to command handler
		resp := handleCommand(req)
		sendResponse(resp)
	}
}

func sendResponse(resp Response) {
	data, err := json.Marshal(resp)
	if err != nil {
		log.Printf("Marshal error: %v", err)
		return
	}

	// Write 4-byte length prefix (Little Endian)
	binary.Write(os.Stdout, binary.LittleEndian, uint32(len(data)))

	// Write the JSON payload
	os.Stdout.Write(data)
}
