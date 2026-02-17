package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const maxFileReadSize = 1024 * 1024  // 1MB hard cap per read
const maxFileWriteSize = 700 * 1024  // ~700KB decoded; base64 ≈ 933KB; fits under Chrome 1MB native messaging limit

// DirEntry represents a single filesystem entry for JSON serialization.
type DirEntry struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// handleCommand dispatches a request to the appropriate handler.
func handleCommand(req Request) Response {
	switch req.Command {
	case "list_dir":
		return handleListDir(req)
	case "read_file":
		return handleReadFile(req)
	case "exec_cmd":
		return handleExecCmd(req)
	case "write_file":
		return handleWriteFile(req)
	default:
		return Response{
			ID:      req.ID,
			Command: req.Command,
			Success: false,
			Error:   fmt.Sprintf("Unknown command: %s", req.Command),
		}
	}
}

func getStringArg(args map[string]interface{}, key string, defaultVal string) string {
	if v, ok := args[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return defaultVal
}

func getFloat64Arg(args map[string]interface{}, key string, defaultVal float64) float64 {
	if v, ok := args[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return defaultVal
}

func handleListDir(req Request) Response {
	path := getStringArg(req.Args, "path", "")
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Cannot determine home directory: " + err.Error()}
		}
		path = home
	}

	// Resolve to absolute path
	absPath, err := filepath.Abs(path)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Invalid path: " + err.Error()}
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: err.Error()}
	}

	result := make([]DirEntry, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		result = append(result, DirEntry{
			Name:    e.Name(),
			IsDir:   e.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format(time.RFC3339),
		})
	}

	return Response{
		ID:      req.ID,
		Command: req.Command,
		Success: true,
		Data: map[string]interface{}{
			"path":    absPath,
			"entries": result,
		},
	}
}

func handleReadFile(req Request) Response {
	path := getStringArg(req.Args, "path", "")
	if path == "" {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "path argument is required"}
	}

	offset := int64(getFloat64Arg(req.Args, "offset", 0))
	limit := int64(getFloat64Arg(req.Args, "limit", float64(maxFileReadSize)))
	if limit > maxFileReadSize {
		limit = maxFileReadSize
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Invalid path: " + err.Error()}
	}

	fileInfo, err := os.Stat(absPath)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: err.Error()}
	}
	if fileInfo.IsDir() {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Path is a directory, not a file"}
	}

	f, err := os.Open(absPath)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: err.Error()}
	}
	defer f.Close()

	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Seek failed: " + err.Error()}
		}
	}

	buf := make([]byte, limit)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Read failed: " + err.Error()}
	}
	buf = buf[:n]

	truncated := (offset + int64(n)) < fileInfo.Size()

	return Response{
		ID:      req.ID,
		Command: req.Command,
		Success: true,
		Data: map[string]interface{}{
			"path":      absPath,
			"content":   base64.StdEncoding.EncodeToString(buf),
			"size":      fileInfo.Size(),
			"truncated": truncated,
		},
	}
}

func handleWriteFile(req Request) Response {
	path := getStringArg(req.Args, "path", "")
	if path == "" {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "path argument is required"}
	}

	content := getStringArg(req.Args, "content", "")
	if content == "" {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "content argument is required"}
	}

	decoded, err := base64.StdEncoding.DecodeString(content)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Invalid base64 content: " + err.Error()}
	}

	if len(decoded) > maxFileWriteSize {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: fmt.Sprintf("File too large: %d bytes exceeds %d byte limit", len(decoded), maxFileWriteSize)}
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Invalid path: " + err.Error()}
	}

	// Create parent directories if needed
	dir := filepath.Dir(absPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Cannot create directories: " + err.Error()}
	}

	if err := os.WriteFile(absPath, decoded, 0644); err != nil {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "Write failed: " + err.Error()}
	}

	return Response{
		ID:      req.ID,
		Command: req.Command,
		Success: true,
		Data: map[string]interface{}{
			"path":         absPath,
			"bytesWritten": len(decoded),
		},
	}
}

func handleExecCmd(req Request) Response {
	command := getStringArg(req.Args, "command", "")
	if command == "" {
		return Response{ID: req.ID, Command: req.Command, Success: false, Error: "command argument is required"}
	}

	timeoutSec := getFloat64Arg(req.Args, "timeout", 30)
	if timeoutSec > 120 {
		timeoutSec = 120
	}
	if timeoutSec < 1 {
		timeoutSec = 1
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	cmd := makeShellCmd(ctx, command)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if ctx.Err() == context.DeadlineExceeded {
			return Response{
				ID:      req.ID,
				Command: req.Command,
				Success: false,
				Error:   fmt.Sprintf("Command timed out after %.0f seconds", timeoutSec),
			}
		} else {
			return Response{
				ID:      req.ID,
				Command: req.Command,
				Success: false,
				Error:   "Exec failed: " + err.Error(),
			}
		}
	}

	return Response{
		ID:      req.ID,
		Command: req.Command,
		Success: true,
		Data: map[string]interface{}{
			"stdout":   stdout.String(),
			"stderr":   stderr.String(),
			"exitCode": exitCode,
		},
	}
}
