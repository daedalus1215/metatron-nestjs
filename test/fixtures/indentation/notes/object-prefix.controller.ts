import { Controller, Get, Post, Param } from '@nestjs/common';

@Controller({ path: 'notes', version: '1' })
export class ObjectPrefixController {
    @Get(':id')
    @ApiOperation({ summary: 'Get one (by id)', extra: { nested: [1, 2] } })
    // the handler is below this comment
    async findOne(@Param('id') id: string): Promise<string> {
        return id;
    }

    @Post()
    @ApiResponse({ status: 201 })
    create(): Promise<void> {
        return Promise.resolve();
    }
}
